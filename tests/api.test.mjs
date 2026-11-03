import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
let server, url, dir, cookieA, cookieB, record;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bw-test-'));
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 30000);
    server.stdout.on('data', (chunk) => {
      const match = /http:\/\/localhost:\d+/.exec(String(chunk));
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    server.on('exit', (code) => reject(new Error('Server exited ' + code)));
    server.stderr.on('data', (chunk) => {
      if (
        !String(chunk).includes('ExperimentalWarning') &&
        !String(chunk).includes('--trace-warnings')
      )
        process.stderr.write(chunk);
    });
  });
});
after(async () => {
  if (server) {
    const closed = once(server, 'exit');
    server.kill();
    await closed;
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function req(path, method = 'GET', data, cookie, origin) {
  const response = await fetch(url + '/api' + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      ...(origin ? { Origin: origin } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
test('unauthenticated data is blocked and two distinct accounts can sign up', async () => {
  assert.equal((await req('/state')).status, 401);
  const a = await req('/auth', 'POST', {
    mode: 'register',
    name: 'Test Studio',
    email: 'a@example.com',
    password: 'unique-password-a',
  });
  assert.equal(a.status, 200);
  cookieA = a.cookie;
  const b = await req('/auth', 'POST', {
    mode: 'register',
    name: 'Other Studio',
    email: 'b@example.com',
    password: 'unique-password-b',
  });
  assert.equal(b.status, 200);
  cookieB = b.cookie;
  assert.notEqual(a.data.id, b.data.id);
  assert.equal((await req('/state', 'GET', undefined, cookieA)).data.records.length, 0);
});
test('invalid login and cross-origin mutations are rejected', async () => {
  assert.equal(
    (
      await req('/auth', 'POST', {
        mode: 'login',
        email: 'a@example.com',
        password: 'wrong-password',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await req(
        '/records',
        'POST',
        { module: 'projects', title: 'X', status: 'Active', data: {} },
        cookieA,
        'https://evil.example',
      )
    ).status,
    403,
  );
});
test('create, versioned edit, stale edit and account isolation', async () => {
  let response = await req(
    '/records',
    'POST',
    {
      module: 'projects',
      title: 'Brand refresh',
      status: 'Active',
      data: { amount: '1000', cost: '200', currency: 'USD' },
    },
    cookieA,
  );
  assert.equal(response.status, 201);
  record = response.data;
  assert.equal((await req('/state', 'GET', undefined, cookieB)).data.records.length, 0);
  assert.equal(
    (await req('/records/' + record.id, 'PATCH', { ...record, title: 'Hacked' }, cookieB)).status,
    404,
  );
  response = await req(
    '/records/' + record.id,
    'PATCH',
    { ...record, title: 'Brand launch' },
    cookieA,
  );
  assert.equal(response.status, 200);
  assert.equal(response.data.version, 2);
  assert.equal(
    (await req('/records/' + record.id, 'PATCH', { ...record, title: 'Stale' }, cookieA)).status,
    409,
  );
  record = response.data;
});
test('archive and restore preserve data and increment versions', async () => {
  let response = await req(
    '/records/' + record.id,
    'PATCH',
    { version: record.version, archived: true },
    cookieA,
  );
  assert.equal(response.status, 200);
  assert.equal(response.data.archived, true);
  record = response.data;
  response = await req(
    '/records/' + record.id,
    'PATCH',
    { version: record.version, archived: false },
    cookieA,
  );
  assert.equal(response.status, 200);
  assert.equal(response.data.archived, false);
  assert.equal(response.data.title, 'Brand launch');
  record = response.data;
});
test('server validation cannot be bypassed for money, URLs, dates or required text', async () => {
  for (const input of [
    { module: 'invoices', data: { client: 'Client', amount: '-10' } },
    { module: 'invoices', data: { client: 'Client', amount: '10', paid: '20' } },
    { module: 'onboarding', data: { client: '' } },
    { module: 'uptime', data: { url: 'javascript:alert(1)' } },
    { module: 'projects', data: { due: '2030-02-31' } },
    { module: 'help', data: { notes: '' } },
  ])
    assert.equal(
      (await req('/records', 'POST', { ...input, title: 'Invalid', status: 'Active' }, cookieA))
        .status,
      400,
    );
});
test('booking conflicts reject overlapping slots but allow adjacent times', async () => {
  const booking = (start, end) => ({
    module: 'booking',
    title: 'Consultation',
    status: 'Active',
    data: {
      client: 'Client',
      start: '2030-01-01T' + start + ':00.000Z',
      end: '2030-01-01T' + end + ':00.000Z',
    },
  });
  assert.equal((await req('/records', 'POST', booking('10:00', '11:00'), cookieA)).status, 201);
  assert.equal((await req('/records', 'POST', booking('10:30', '11:30'), cookieA)).status, 409);
  assert.equal((await req('/records', 'POST', booking('11:00', '12:00'), cookieA)).status, 201);
});
test('feedback voting is idempotent', async () => {
  const r = (
    await req(
      '/records',
      'POST',
      { module: 'feedback', title: 'Add calendar sync', status: 'Draft', data: {} },
      cookieA,
    )
  ).data;
  assert.equal((await req('/records/' + r.id + '/vote', 'POST', {}, cookieA)).status, 200);
  await req('/records/' + r.id + '/vote', 'POST', {}, cookieA);
  const state = (await req('/state', 'GET', undefined, cookieA)).data;
  assert.equal(state.records.find((i) => i.id === r.id).votes, 1);
});
test('a retried create request produces only one record', async () => {
  const payload = {
    module: 'projects',
    title: 'One request',
    status: 'Draft',
    data: {},
    requestKey: '11111111-1111-4111-a111-111111111111',
  };
  const first = await req('/records', 'POST', payload, cookieA);
  const retry = await req('/records', 'POST', payload, cookieA);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(first.data.id, retry.data.id);
  assert.equal(
    (await req('/records', 'POST', { ...payload, title: 'Changed request' }, cookieA)).status,
    409,
  );
});
test('unsafe website checks are blocked and only the owner sees their history', async () => {
  const r = (
    await req(
      '/records',
      'POST',
      { module: 'uptime', title: 'Local test', status: 'Draft', data: { url: 'http://127.0.0.1' } },
      cookieA,
    )
  ).data;
  const check = await req('/records/' + r.id + '/check', 'POST', {}, cookieA);
  assert.equal(check.status, 200);
  assert.equal(check.data.ok, false);
  assert.match(check.data.error, /private/);
  assert.equal((await req('/state', 'GET', undefined, cookieB)).data.checks.length, 0);
});
test('malformed page URLs do not crash the server', async () => {
  assert.equal((await fetch(url + '/%ZZ')).status, 400);
  assert.equal((await req('/state', 'GET', undefined, cookieA)).status, 200);
});

test('logout invalidates the server session', async () => {
  assert.equal((await req('/logout', 'POST', {}, cookieB)).status, 200);
  assert.equal((await req('/state', 'GET', undefined, cookieB)).status, 401);
});
