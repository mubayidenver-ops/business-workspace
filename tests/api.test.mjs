import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { localDynamoFixture } from './dynamo-support.mjs';
let server, url, dir, cookieA, cookieB, record, dynamo;
before(async () => {
  if (process.env.DYNAMODB_TEST_ENDPOINT) dynamo = await localDynamoFixture();
  dir = await mkdtemp(join(tmpdir(), 'bw-test-'));
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: '0',
      STORAGE_BACKEND: dynamo ? 'dynamodb' : 'sqlite',
      ...(dynamo
        ? {
            NODE_ENV: 'test',
            DYNAMODB_ENDPOINT: dynamo.endpoint,
            DYNAMODB_TABLE: dynamo.table,
            AWS_REGION: 'eu-north-1',
          }
        : {}),
    },
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
  if (dynamo) await dynamo.close();
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
test('public readiness check does not expose workspace data', async () => {
  const response = await req('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { status: 'ready' });
});

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

test('private proposal links allow one response and keep workspace details private', async () => {
  const proposal = (
    await req(
      '/records',
      'POST',
      {
        module: 'proposals',
        title: 'Client offer',
        status: 'Active',
        data: {
          client: 'Client',
          amount: '0',
          currency: 'USD',
          lineItems: JSON.stringify([{ description: 'Design', quantity: 2, rate: 100.05 }]),
          discountPercent: '10',
          taxPercent: '15',
          notes: 'Deliver a new identity.',
        },
      },
      cookieA,
    )
  ).data;
  assert.equal(proposal.data.amount, '207.1');
  assert.equal(
    (
      await req(
        '/records/' + proposal.id + '/share',
        'POST',
        { version: proposal.version, confirmed: false },
        cookieA,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        '/records/' + proposal.id + '/share',
        'POST',
        { version: proposal.version, confirmed: true },
        cookieB,
      )
    ).status,
    404,
  );
  const share = await req(
    '/records/' + proposal.id + '/share',
    'POST',
    { version: proposal.version, confirmed: true, days: 7 },
    cookieA,
  );
  assert.equal(share.status, 201);
  assert.equal(share.data.token.length, 64);
  const token = share.data.token;
  const read = await guest(token);
  assert.equal(read.status, 200);
  assert.equal(read.data.document.total, 207.1);
  assert.equal(read.data.user_id, undefined);
  assert.equal(read.data.email, undefined);
  assert.equal(
    (await guest(token, 'POST', { version: proposal.version, name: 'Client', action: 'approve' }))
      .status,
    200,
  );
  assert.equal((await guest(token)).status, 410);
  const state = (await req('/state', 'GET', undefined, cookieA)).data;
  const updated = state.records.find((r) => r.id === proposal.id);
  assert.equal(updated.status, 'Completed');
  assert.equal(JSON.parse(updated.data.clientResponse).action, 'approve');
  assert.equal(JSON.stringify(state).includes(token), false);
  const key = crypto.randomUUID();
  const converted = await req(
    '/records/' + proposal.id + '/convert',
    'POST',
    { version: updated.version, requestKey: key },
    cookieA,
  );
  assert.equal(converted.status, 201);
  assert.equal(converted.data.module, 'invoices');
  assert.equal(converted.data.status, 'Draft');
  assert.equal(converted.data.data.amount, '207.1');
  assert.equal(converted.data.data.paid, '0');
  const again = await req(
    '/records/' + proposal.id + '/convert',
    'POST',
    { version: updated.version, requestKey: key },
    cookieA,
  );
  assert.equal(again.data.id, converted.data.id);
});
test('sharing can be revoked, replaced, and invalidated by editing', async () => {
  let record = (
    await req(
      '/records',
      'POST',
      {
        module: 'help',
        title: 'Shared guide',
        status: 'Active',
        data: { notes: 'Useful information' },
      },
      cookieA,
    )
  ).data;
  const create = () =>
    req(
      '/records/' + record.id + '/share',
      'POST',
      { version: record.version, confirmed: true },
      cookieA,
    );
  const first = (await create()).data.token,
    second = (await create()).data.token;
  assert.equal((await guest(first)).status, 410);
  assert.equal((await guest(second)).status, 200);
  await req('/records/' + record.id + '/share', 'DELETE', {}, cookieA);
  assert.equal((await guest(second)).status, 410);
  const third = (await create()).data.token;
  record = (
    await req('/records/' + record.id, 'PATCH', { ...record, title: 'Updated guide' }, cookieA)
  ).data;
  assert.equal((await guest(third)).status, 410);
});
test('public onboarding hides internal notes and validates the submitted brief', async () => {
  const record = (
    await req(
      '/records',
      'POST',
      {
        module: 'onboarding',
        title: 'New project brief',
        status: 'Draft',
        data: {
          client: 'New client',
          email: 'internal@example.com',
          notes: 'PRIVATE STAFF NOTES',
          publicNotes: 'Tell us your goals.',
        },
      },
      cookieA,
    )
  ).data;
  const token = (
    await req(
      '/records/' + record.id + '/share',
      'POST',
      { version: record.version, confirmed: true },
      cookieA,
    )
  ).data.token;
  const view = await guest(token);
  assert.equal(view.data.data.publicNotes, 'Tell us your goals.');
  assert.equal(JSON.stringify(view.data).includes('PRIVATE STAFF NOTES'), false);
  assert.equal(JSON.stringify(view.data).includes('internal@example.com'), false);
  assert.equal(
    (
      await guest(token, 'POST', {
        version: record.version,
        name: 'Client',
        email: 'invalid',
        message: 'Help with a website.',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await guest(token, 'POST', {
        version: record.version,
        name: 'Client',
        email: 'client@example.com',
        message: 'Help with a website.',
      })
    ).status,
    200,
  );
});
test('testimonials cannot be shared without consent', async () => {
  const record = (
    await req(
      '/records',
      'POST',
      {
        module: 'testimonials',
        title: 'Review',
        status: 'Draft',
        data: { client: 'Client', notes: 'Good work', consent: false },
      },
      cookieA,
    )
  ).data;
  assert.equal(
    (
      await req(
        '/records/' + record.id + '/share',
        'POST',
        { version: record.version, confirmed: true },
        cookieA,
      )
    ).status,
    400,
  );
});
async function guest(token, method = 'GET', body) {
  const response = await fetch(url + '/api/public', {
    method,
    headers: {
      'X-Workspace-Share': token,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
test('changing password invalidates all existing sessions and preserves records', async () => {
  const email = 'password-test@example.com',
    oldPassword = 'old-password-long',
    newPassword = 'new-password-long';
  const created = await req('/auth', 'POST', {
    mode: 'register',
    name: 'Password test',
    email,
    password: oldPassword,
  });
  const cookie = created.cookie;
  const second = (await req('/auth', 'POST', { mode: 'login', email, password: oldPassword }))
    .cookie;
  await req(
    '/records',
    'POST',
    { module: 'projects', title: 'Keep this', status: 'Draft', data: {} },
    cookie,
  );
  assert.equal(
    (await req('/password', 'POST', { currentPassword: 'incorrect-password', newPassword }, cookie))
      .status,
    400,
  );
  assert.equal(
    (await req('/password', 'POST', { currentPassword: oldPassword, newPassword }, cookie)).status,
    200,
  );
  assert.equal((await req('/state', 'GET', undefined, cookie)).status, 401);
  assert.equal((await req('/state', 'GET', undefined, second)).status, 401);
  assert.equal(
    (await req('/auth', 'POST', { mode: 'login', email, password: oldPassword })).status,
    401,
  );
  const fresh = await req('/auth', 'POST', { mode: 'login', email, password: newPassword });
  assert.equal(fresh.status, 200);
  assert.equal(
    (await req('/state', 'GET', undefined, fresh.cookie)).data.records[0].title,
    'Keep this',
  );
});
test('logout invalidates the server session', async () => {
  assert.equal((await req('/logout', 'POST', {}, cookieB)).status, 200);
  assert.equal((await req('/state', 'GET', undefined, cookieB)).status, 401);
});
