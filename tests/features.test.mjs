import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { localDynamoFixture } from './dynamo-support.mjs';
import { totpCode, currentStep } from '../server/totp.mjs';

let server, url, dir, dynamo;
before(async () => {
  if (process.env.DYNAMODB_TEST_ENDPOINT) dynamo = await localDynamoFixture();
  dir = await mkdtemp(join(tmpdir(), 'bw-features-'));
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
      if (!/ExperimentalWarning|--trace-warnings/.test(String(chunk))) process.stderr.write(chunk);
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

const cookies = (response, jar = '') => {
  const map = new Map(jar.split('; ').filter(Boolean).map((c) => c.split('=')));
  for (const c of response.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (v) map.set(k, v);
    else map.delete(k);
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
};
async function call(path, { method = 'GET', data, cookie, headers = {} } = {}) {
  const response = await fetch(url + '/api' + path, {
    method,
    headers: {
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json(), response };
}
let n = 0;
async function account(name = 'Team ' + ++n) {
  const email = `user${Date.now()}${++n}@example.com`;
  const r = await call('/auth', {
    method: 'POST',
    data: { mode: 'register', email, password: 'correct horse battery', name },
  });
  assert.equal(r.status, 200);
  return { email, name, id: r.body.id, cookie: cookies(r.response) };
}
const create = (cookie, module, title, data = {}, status = 'Active') =>
  call('/records', { method: 'POST', cookie, data: { module, title, status, data } });

test('owners invite members who share the workspace with role limits', async () => {
  const owner = await account('Acme Studio');
  const member = await account();
  const outsider = await account();
  const invite = await call('/team/invites', {
    method: 'POST',
    cookie: owner.cookie,
    data: { email: member.email, role: 'member' },
  });
  assert.equal(invite.status, 201);
  const preview = await call('/invite', { headers: { 'X-Workspace-Invite': invite.body.token } });
  assert.equal(preview.body.workspaceName, 'Acme Studio');
  const wrong = await call('/invite/accept', {
    method: 'POST',
    cookie: outsider.cookie,
    data: {},
    headers: { 'X-Workspace-Invite': invite.body.token },
  });
  assert.equal(wrong.status, 403);
  const accepted = await call('/invite/accept', {
    method: 'POST',
    cookie: member.cookie,
    data: {},
    headers: { 'X-Workspace-Invite': invite.body.token },
  });
  assert.equal(accepted.status, 200);
  const memberCookie = cookies(accepted.response, member.cookie);
  const reused = await call('/invite', { headers: { 'X-Workspace-Invite': invite.body.token } });
  assert.equal(reused.status, 410);

  const shared = await create(owner.cookie, 'feedback', 'Dark mode');
  const state = await call('/state', { cookie: memberCookie });
  assert.equal(state.body.workspace.role, 'member');
  assert.ok(state.body.records.some((r) => r.id === shared.body.id));
  const added = await create(memberCookie, 'feedback', 'Member idea');
  assert.equal(added.status, 201);
  assert.ok((await call('/state', { cookie: owner.cookie })).body.records.some((r) => r.id === added.body.id));
  assert.equal(
    (await call('/state', { cookie: member.cookie })).body.workspace.id,
    member.id,
    'without the workspace cookie the member sees their own workspace',
  );

  const archive = await call('/records/' + shared.body.id, {
    method: 'PATCH',
    cookie: memberCookie,
    data: { version: shared.body.version, archived: true },
  });
  assert.equal(archive.status, 403);
  assert.equal(
    (await call('/team/invites', { method: 'POST', cookie: memberCookie, data: { email: 'x@example.com', role: 'member' } })).status,
    403,
  );
  assert.equal((await call('/billing/checkout', { method: 'POST', cookie: memberCookie, data: {} })).status, 403);

  const promote = await call('/team/members/' + member.id, {
    method: 'PATCH',
    cookie: owner.cookie,
    data: { role: 'admin' },
  });
  assert.equal(promote.status, 200);
  const archived = await call('/records/' + shared.body.id, {
    method: 'PATCH',
    cookie: memberCookie,
    data: { version: shared.body.version, archived: true },
  });
  assert.equal(archived.status, 200);
  assert.equal(
    (await call('/team/invites', { method: 'POST', cookie: memberCookie, data: { email: 'x@example.com', role: 'admin' } })).status,
    403,
    'admins cannot invite admins',
  );
  const team = await call('/team', { cookie: owner.cookie });
  assert.equal(team.body.members.length, 1);
  assert.equal(team.body.members[0].role, 'admin');

  const switched = await call('/workspaces/active', { method: 'POST', cookie: outsider.cookie, data: { id: owner.id } });
  assert.equal(switched.status, 404);
  const removed = await call('/team/members/' + member.id, { method: 'DELETE', cookie: owner.cookie });
  assert.equal(removed.status, 200);
  assert.equal((await call('/state', { cookie: memberCookie })).body.workspace.id, member.id);
});

test('authenticator 2FA protects sign-in, rejects replays and supports recovery codes', async () => {
  const user = await account();
  const setup = await call('/security/totp/setup', { method: 'POST', cookie: user.cookie, data: {} });
  assert.match(setup.body.uri, /^otpauth:\/\/totp\//);
  const bad = await call('/security/totp/enable', { method: 'POST', cookie: user.cookie, data: { code: '000000' } });
  assert.equal(bad.status, 400);
  const step = currentStep() - 1;
  const enable = await call('/security/totp/enable', {
    method: 'POST',
    cookie: user.cookie,
    data: { code: totpCode(setup.body.secret, step) },
  });
  assert.equal(enable.status, 200);
  assert.equal(enable.body.recoveryCodes.length, 8);
  const login = (code) =>
    call('/auth', { method: 'POST', data: { email: user.email, password: 'correct horse battery', code } });
  const missing = await login();
  assert.equal(missing.status, 401);
  assert.equal(missing.body.twoFactorRequired, true);
  assert.equal((await login(totpCode(setup.body.secret, step))).status, 401, 'used code is rejected');
  const ok = await login(totpCode(setup.body.secret, currentStep()));
  assert.equal(ok.status, 200);
  const recovery = enable.body.recoveryCodes[0];
  assert.equal((await login(recovery)).status, 200);
  assert.equal((await login(recovery)).status, 401, 'recovery codes are single-use');
  const security = await call('/security', { cookie: user.cookie });
  assert.deepEqual(security.body, { totp: true, recoveryCodesLeft: 7 });
});

test('sign out everywhere revokes every session and account deletion removes data', async () => {
  const user = await account();
  const second = await call('/auth', { method: 'POST', data: { email: user.email, password: 'correct horse battery' } });
  const other = cookies(second.response);
  await create(user.cookie, 'help', 'Getting started', { notes: 'Welcome' });
  assert.equal((await call('/security/sessions/revoke', { method: 'POST', cookie: user.cookie, data: {} })).status, 200);
  assert.equal((await call('/state', { cookie: other })).status, 401);
  assert.equal((await call('/state', { cookie: user.cookie })).status, 401);

  const again = await call('/auth', { method: 'POST', data: { email: user.email, password: 'correct horse battery' } });
  const cookie = cookies(again.response);
  const wrong = await call('/account/delete', { method: 'POST', cookie, data: { confirm: user.email, password: 'nope nope nope' } });
  assert.equal(wrong.status, 400);
  const deleted = await call('/account/delete', {
    method: 'POST',
    cookie,
    data: { confirm: user.email, password: 'correct horse battery' },
  });
  assert.equal(deleted.status, 200);
  assert.equal((await call('/state', { cookie })).status, 401);
  const login = await call('/auth', { method: 'POST', data: { email: user.email, password: 'correct horse battery' } });
  assert.equal(login.status, 401);
  const reregister = await call('/auth', {
    method: 'POST',
    data: { mode: 'register', email: user.email, password: 'correct horse battery', name: 'New' },
  });
  assert.equal(reregister.status, 200);
  assert.equal((await call('/state', { cookie: cookies(reregister.response) })).body.records.length, 0);
});

test('public feedback board, testimonial page, help centre and status page', async () => {
  const owner = await account('Northwind');
  const page = async (kind) => {
    const r = await call('/pages', { method: 'POST', cookie: owner.cookie, data: { kind } });
    assert.equal(r.status, 201);
    return { 'X-Workspace-Page': r.body.token };
  };
  const visible = await create(owner.cookie, 'feedback', 'Export to PDF', { notes: 'Please' });
  await create(owner.cookie, 'feedback', 'Private draft', {}, 'Draft');
  const board = await page('feedback');
  let got = await call('/page', { headers: board });
  assert.equal(got.body.brand, 'Northwind');
  assert.deepEqual(got.body.requests.map((r) => r.title), ['Export to PDF']);
  const voter = 'a'.repeat(32);
  const vote = (v = voter) =>
    call('/page', { method: 'POST', headers: board, data: { action: 'vote', id: visible.body.id, voter: v } });
  assert.equal((await vote()).body.counted, true);
  assert.equal((await vote()).body.counted, false);
  await vote('b'.repeat(32));
  got = await call('/page', { headers: board });
  assert.equal(got.body.requests[0].votes, 2);
  const submitted = await call('/page', {
    method: 'POST',
    headers: board,
    data: { action: 'submit', title: 'Calendar sync', notes: 'Google calendar', name: 'Pat' },
  });
  assert.equal(submitted.status, 201);
  const state = await call('/state', { cookie: owner.cookie });
  const draft = state.body.records.find((r) => r.title === 'Calendar sync');
  assert.equal(draft.status, 'Draft');
  assert.equal(draft.data.client, 'Pat');
  assert.equal((await call('/page', { headers: board })).body.requests.length, 1, 'submissions wait for moderation');

  const testimonials = await page('testimonials');
  await create(owner.cookie, 'testimonials', 'Great', { client: 'Lee', notes: 'Loved it', consent: true });
  await create(owner.cookie, 'testimonials', 'No consent', { client: 'Sam', notes: 'Shh', consent: false });
  assert.deepEqual((await call('/page', { headers: testimonials })).body.testimonials, [{ client: 'Lee', notes: 'Loved it' }]);
  assert.equal(
    (await call('/page', { method: 'POST', headers: testimonials, data: { action: 'submit', name: 'Kim', notes: 'Superb', consent: true } })).status,
    201,
  );
  assert.equal(
    (await call('/page', { method: 'POST', headers: testimonials, data: { action: 'vote', id: visible.body.id, voter } })).status,
    400,
  );

  const help = await page('help');
  await create(owner.cookie, 'help', 'Resetting passwords', { category: 'Account', notes: 'Use settings.' });
  await create(owner.cookie, 'help', 'Internal', { notes: 'secret' }, 'Draft');
  assert.deepEqual((await call('/page', { headers: help })).body.articles.map((a) => a.title), ['Resetting passwords']);

  const status = await page('status');
  await create(owner.cookie, 'uptime', 'Website', { url: 'https://example.invalid' });
  const statusPage = await call('/page', { headers: status });
  assert.equal(statusPage.body.monitors[0].title, 'Website');
  assert.equal(statusPage.body.monitors[0].ok, null);

  assert.equal((await call('/pages/help', { method: 'DELETE', cookie: owner.cookie })).status, 200);
  assert.equal((await call('/page', { headers: help })).status, 410);
  assert.equal((await call('/page', { headers: { 'X-Workspace-Page': 'f'.repeat(64) } })).status, 410);
});

test('weekly availability booking page with guest reschedule and cancel links', async () => {
  const owner = await account('Clinic');
  assert.equal((await call('/pages', { method: 'POST', cookie: owner.cookie, data: { kind: 'booking' } })).status, 400);
  const windows = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '12:00' }));
  const availability = await call('/availability', {
    method: 'PUT',
    cookie: owner.cookie,
    data: { title: 'Consultation', timezone: 'UTC', windows, slotMinutes: 60, noticeHours: 1, horizonDays: 14 },
  });
  assert.equal(availability.status, 200);
  const created = await call('/pages', { method: 'POST', cookie: owner.cookie, data: { kind: 'booking' } });
  const headers = { 'X-Workspace-Page': created.body.token };
  const page = await call('/page', { headers });
  assert.equal(page.body.title, 'Consultation');
  assert.ok(page.body.slots.length >= 30);
  const [first, second] = page.body.slots;
  const book = (start) =>
    call('/page', { method: 'POST', headers, data: { action: 'book', start, name: 'Ana', email: 'ana@example.com' } });
  const booked = await book(first);
  assert.equal(booked.status, 201);
  assert.equal((await book(first)).status, 409, 'a slot cannot be double-booked');
  assert.equal((await book('2020-01-01T09:00:00.000Z')).status, 409);
  assert.ok(!(await call('/page', { headers })).body.slots.includes(first));

  const manage = { 'X-Booking-Token': booked.body.manageToken };
  const view = await call('/booking-manage', { headers: manage });
  assert.equal(view.body.start, first);
  assert.ok(view.body.slots.includes(second));
  const moved = await call('/booking-manage', { method: 'POST', headers: manage, data: { action: 'reschedule', start: second } });
  assert.equal(moved.status, 200);
  let state = await call('/state', { cookie: owner.cookie });
  const record = state.body.records.find((r) => r.module === 'booking');
  assert.equal(record.data.start, second);
  assert.equal(record.data.email, 'ana@example.com');
  const cancelled = await call('/booking-manage', { method: 'POST', headers: manage, data: { action: 'cancel' } });
  assert.equal(cancelled.status, 200);
  state = await call('/state', { cookie: owner.cookie });
  assert.equal(state.body.records.find((r) => r.module === 'booking').status, 'Cancelled');
  assert.equal((await call('/booking-manage', { headers: manage })).status, 410);
  assert.ok((await call('/page', { headers })).body.slots.includes(second), 'cancelled slot reopens');
});

test('project timesheets and equipment work orders are validated and preserved', async () => {
  const owner = await account();
  const project = await create(owner.cookie, 'projects', 'Website', {
    amount: '1000',
    hourlyRate: '50',
    hourlyCost: '20',
    currency: 'usd',
    timeEntries: JSON.stringify([{ date: '2026-01-02', hours: 3, person: 'Jo', billable: true }]),
  });
  assert.equal(project.status, 201);
  assert.equal(JSON.parse(project.body.data.timeEntries)[0].hours, 3);
  const invalid = await create(owner.cookie, 'projects', 'Bad', { timeEntries: JSON.stringify([{ date: 'x', hours: 3 }]) });
  assert.equal(invalid.status, 400);
  const edited = await call('/records/' + project.body.id, {
    method: 'PATCH',
    cookie: owner.cookie,
    data: { version: project.body.version, title: 'Website v2', status: 'Active', data: { amount: '1200' } },
  });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.data.timeEntries, 'editing other fields keeps the timesheet');

  const asset = await create(owner.cookie, 'equipment', 'Generator', {
    due: '2026-01-01',
    serviceIntervalDays: '30',
    workOrders: JSON.stringify([{ id: 'wo-12345678', title: 'Replace filter', status: 'Open', due: '2026-01-01' }]),
  });
  assert.equal(asset.status, 201);
  const serviced = await call(`/records/${asset.body.id}/service`, {
    method: 'POST',
    cookie: owner.cookie,
    data: { version: asset.body.version, date: '2026-01-05', notes: 'Filter swapped', workOrderId: 'wo-12345678' },
  });
  assert.equal(serviced.status, 200);
  assert.equal(serviced.body.data.due, '2026-02-04');
  assert.equal(serviced.body.data.lastService, '2026-01-05');
  assert.equal(JSON.parse(serviced.body.data.workOrders)[0].status, 'Done');
  assert.equal(JSON.parse(serviced.body.data.serviceLog)[0].notes, 'Filter swapped');
  const badInterval = await create(owner.cookie, 'equipment', 'Bad', { serviceIntervalDays: '1.5' });
  assert.equal(badInterval.status, 400);
});
