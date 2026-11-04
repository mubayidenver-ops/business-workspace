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
async function req(path, method = 'GET', data, cookie, origin, workspace) {
  const response = await fetch(url + '/api' + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      ...(origin ? { Origin: origin } : {}),
      ...(workspace ? { 'X-Workspace': workspace } : {}),
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
test('billing is private and disabled checkout cannot accept a payment claim', async () => {
  assert.equal((await req('/billing')).status, 401);
  const summary = await req('/billing', 'GET', undefined, cookieA);
  assert.equal(summary.status, 200);
  assert.equal(summary.data.mode, 'disabled');
  assert.equal(summary.data.plan, 'free');
  assert.deepEqual(summary.data.orders, []);
  assert.equal(
    (
      await req(
        '/billing/checkout',
        'POST',
        {
          accepted: true,
          requestKey: '00000000-0000-0000-0000-000000000000',
          paid: true,
          amount: 1,
        },
        cookieA,
      )
    ).status,
    503,
  );
  assert.equal(
    (await req('/billing/checkout', 'POST', {}, cookieA, 'https://evil.example')).status,
    403,
  );
  assert.equal(
    (await req('/billing/BW000000000000000000000000000000/check', 'POST', {}, cookieB)).status,
    404,
  );
  const callback = await fetch(url + '/api/billing/paynow/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'status=Paid&amount=9.00',
  });
  assert.equal(callback.status, 503);
  assert.equal((await req('/billing', 'GET', undefined, cookieA)).data.plan, 'free');
});

test('logout invalidates the server session', async () => {
  assert.equal((await req('/logout', 'POST', {}, cookieB)).status, 200);
  assert.equal((await req('/state', 'GET', undefined, cookieB)).status, 401);
});

test('quote revision history preserves the saved totals and stays private', async () => {
  const input = {
    module: 'proposals',
    title: 'Original quote',
    status: 'Draft',
    data: { client: 'Client', amount: '100', currency: 'USD' },
  };
  const created = await req('/records', 'POST', input, cookieA);
  assert.equal(created.status, 201);
  const route = '/records/' + created.data.id;
  const edit = await req(
    route,
    'PATCH',
    { ...input, version: 1, title: 'Revised quote', data: { ...input.data, amount: '120' } },
    cookieA,
  );
  assert.equal(edit.status, 200);
  assert.equal((await req(route + '/revisions')).status, 401);
  const history = await req(route + '/revisions', 'GET', undefined, cookieA);
  assert.equal(history.status, 200);
  assert.deepEqual(
    history.data.map(({ title, version, data }) => [title, version, data.amount]),
    [['Original quote', 1, '100']],
  );
});
test('an offered appointment admits one guest and keeps its time reserved', async () => {
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.parse(start) + 3600000).toISOString();
  const input = {
    module: 'booking',
    title: 'Consultation',
    status: 'Active',
    data: {
      client: 'Available slot',
      offerSlot: true,
      start,
      end,
      notes: 'Private note',
    },
  };
  const created = await req('/records', 'POST', input, cookieA);
  assert.equal(created.status, 201);
  const id = created.data.id;
  const shared = await req(
    '/records/' + id + '/share',
    'POST',
    { version: 1, days: 7, confirmed: true },
    cookieA,
  );
  assert.equal(shared.status, 201);
  assert.equal(shared.data.expires, Date.parse(start));
  const link = await guest(shared.data.token);
  assert.deepEqual(link.data.data, { start, end });
  const [first, second] = await Promise.all(
    ['Guest A', 'Guest B'].map((name) =>
      guest(shared.data.token, 'POST', { version: 1, name, email: 'guest@example.com' }),
    ),
  );
  assert.equal([first, second].filter((r) => r.status === 200).length, 1);
  assert.equal((await guest(shared.data.token)).status, 410);
  assert.equal((await req('/records', 'POST', input, cookieA)).status, 409);
  const state = await req('/state', 'GET', undefined, cookieA);
  const booking = state.data.records.find((r) => r.id === id);
  assert.equal(booking.status, 'Active');
  assert.equal(booking.data.offerSlot, false);
  assert.equal(JSON.parse(booking.data.clientResponse).email, 'guest@example.com');
});

test('shared collections accept only selected workspace records and expire on revision', async () => {
  const create = (title, cookie) =>
    req(
      '/records',
      'POST',
      {
        module: 'help',
        title,
        status: 'Active',
        data: { category: 'Guides', notes: 'Instructions' },
      },
      cookie,
    );
  const owner = await create('First guide', cookieA);
  const related = await create('Related guide', cookieA);
  const other = await req('/auth', 'POST', {
    mode: 'login',
    email: 'b@example.com',
    password: 'unique-password-b',
  });
  const foreign = await create('Other workspace guide', other.cookie);
  assert.equal(foreign.status, 201);
  const route = '/records/' + owner.data.id + '/share';
  const share = (id) =>
    req(route, 'POST', { version: 1, days: 1, confirmed: true, collection: [id] }, cookieA);
  assert.equal((await share(foreign.data.id)).status, 400);
  const accepted = await share(related.data.id);
  assert.equal(accepted.status, 201);
  const projection = await guest(accepted.data.token);
  assert.equal(projection.data.entries[0].title, 'Related guide');
  assert.ok(!Object.hasOwn(projection.data.entries[0], 'user_id'));
  assert.equal(
    (await req('/records/' + related.data.id, 'PATCH', { version: 1, archived: true }, cookieA))
      .status,
    200,
  );
  assert.equal((await guest(accepted.data.token)).status, 410);
});

test('digital delivery only exposes a selected file through an expiring link', async () => {
  const attachment = JSON.stringify({
    name: 'guide.pdf',
    mime: 'application/pdf',
    content: Buffer.from('%PDF-1.4').toString('base64'),
  });
  const created = await req(
    '/records',
    'POST',
    {
      module: 'store',
      title: 'Guide',
      status: 'Active',
      data: { amount: '10', currency: 'USD', notes: 'Product', attachment },
    },
    cookieA,
  );
  assert.equal(created.status, 201);
  const route = '/records/' + created.data.id + '/share';
  const shared = await req(route, 'POST', { version: 1, confirmed: true }, cookieA);
  assert.equal(shared.status, 201);
  const projection = await guest(shared.data.token);
  assert.deepEqual(projection.data.data, { notes: 'Product', attachment });
  assert.equal((await req(route, 'DELETE', {}, cookieA)).status, 200);
  assert.equal((await guest(shared.data.token)).status, 410);
});

test('workspace roles isolate data, restrict editing, and enforce revocation', async () => {
  const member = await req('/auth', 'POST', {
    mode: 'login',
    email: 'b@example.com',
    password: 'unique-password-b',
  });
  assert.equal(member.status, 200);
  const owner = (await req('/state', 'GET', undefined, cookieA)).data.user;
  const memberRequest = (path, method = 'GET', payload) =>
    req(path, method, payload, member.cookie, undefined, owner.id);
  assert.equal((await memberRequest('/state')).status, 403);
  const grant = (role) =>
    req(
      '/team',
      'POST',
      { email: member.data.email, memberId: member.data.id, role, confirmed: true },
      cookieA,
    );
  assert.equal((await grant('viewer')).status, 200);
  const read = await memberRequest('/state');
  assert.equal(read.data.workspace.role, 'viewer');
  assert.equal(read.data.user.id, member.data.id);
  assert.equal(read.data.workspace.id, owner.id);
  assert.ok(read.data.records.length > 0);
  const payload = {
    module: 'projects',
    title: 'Team project',
    status: 'Active',
    data: { amount: '0' },
  };
  assert.equal((await memberRequest('/records', 'POST', payload)).status, 403);
  assert.equal((await grant('editor')).status, 200);
  const created = await memberRequest('/records', 'POST', payload);
  assert.equal(created.status, 201);
  const record = '/records/' + created.data.id;
  assert.equal(
    (await memberRequest(record, 'PATCH', { ...payload, version: 1, title: 'Edited project' }))
      .status,
    200,
  );
  assert.equal((await memberRequest(record, 'PATCH', { version: 2, archived: true })).status, 403);
  assert.equal((await memberRequest('/billing')).status, 403);
  assert.equal(
    (await memberRequest(record + '/share', 'POST', { version: 2, confirmed: true })).status,
    403,
  );
  assert.equal(
    (await memberRequest(record + '/draft', 'POST', { version: 2, confirmed: true })).status,
    403,
  );
  assert.equal((await req('/team', 'DELETE', { memberId: member.data.id }, cookieA)).status, 200);
  assert.equal((await memberRequest('/state')).status, 403);
  const team = await req('/team', 'GET', undefined, cookieA);
  assert.equal(team.data.members.length, 0);
  assert.deepEqual(
    team.data.audit.map((event) => event.action),
    ['revoked', 'editor', 'viewer'],
  );
});

test('maintenance completion advances the next due date only once', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const input = {
    module: 'equipment',
    title: 'Service pump',
    status: 'Active',
    data: { client: 'Warehouse', due: date, repeatDays: '30' },
  };
  const created = await req('/records', 'POST', input, cookieA);
  assert.equal(created.status, 201);
  const path = '/records/' + created.data.id + '/renew';
  const results = await Promise.all(
    [1, 1].map((version) => req(path, 'POST', { version, date }, cookieA)),
  );
  const complete = results.find((result) => result.status === 200);
  assert.ok(complete);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(complete.data.data.lastCompleted, date);
  assert.equal(
    complete.data.data.due,
    new Date(Date.parse(date) + 30 * 86400000).toISOString().slice(0, 10),
  );
  assert.equal((await req(path, 'POST', { version: 2, date }, cookieA)).status, 409);
});

test('recurring reservations are atomic and group links confirm one guest per slot', async () => {
  const at = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const slot = (days) => ({
    start: at(days),
    end: new Date(Date.parse(at(days)) + 3600000).toISOString(),
  });
  const first = slot(8);
  const second = slot(15);
  const requestKey = '079c18c7-10f6-42d1-8ac1-3709ddaf20fd';
  const series = { title: 'Weekly consult', requestKey, slots: [first, second] };
  assert.equal((await req('/booking-series', 'POST', series, cookieA)).status, 201);
  assert.equal((await req('/booking-series', 'POST', series, cookieA)).status, 201);
  const conflicting = await req(
    '/booking-series',
    'POST',
    {
      title: 'Atomic failure',
      requestKey: '86c5bdea-a5f4-4a11-87a3-46b0d44f4676',
      slots: [slot(23), second],
    },
    cookieA,
  );
  assert.equal(conflicting.status, 409);
  const state = (await req('/state', 'GET', undefined, cookieA)).data;
  assert.ok(!state.records.some((record) => record.title === 'Atomic failure'));
  const records = state.records
    .filter((record) => record.title === series.title)
    .sort((a, b) => a.data.start.localeCompare(b.data.start));
  assert.equal(records.length, 2);
  const path = '/records/' + records[0].id + '/share';
  const shared = await req(
    path,
    'POST',
    { version: 1, confirmed: true, collection: [records[1].id] },
    cookieA,
  );
  assert.equal(shared.status, 201);
  const token = shared.data.token;
  const read = await guest(token);
  assert.equal(read.data.slots.length, 2);
  const book = (slotId) =>
    guest(token, 'POST', { slotId, version: 1, name: 'Guest', email: 'guest@example.com' });
  const attempts = await Promise.all([book(records[0].id), book(records[0].id)]);
  assert.equal(attempts.filter((result) => result.status === 200).length, 1);
  assert.deepEqual(
    (await guest(token)).data.slots.map((slot) => slot.id),
    [records[1].id],
  );
  assert.equal((await book(records[1].id)).status, 200);
  assert.deepEqual((await guest(token)).data.slots, []);
  assert.equal((await req(path, 'DELETE', {}, cookieA)).status, 200);
  assert.equal((await guest(token)).status, 410);
});
