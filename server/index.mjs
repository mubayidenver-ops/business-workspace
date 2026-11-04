import { mfaKey, seal, unseal, base32, matchStep, recoveryHash, verifyMfa } from './mfa.mjs';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './storage/index.mjs';
import { validateRecord } from './validation.mjs';
import { safeFetch } from './network.mjs';
import { runMonitorCycle } from './uptime.mjs';
import { registrationExpiry } from './rdap.mjs';
import { aiConfig, draftRecord } from './ai-drafts.mjs';
import { reminderConfig, sendInvoiceReminders } from './invoice-reminders.mjs';
import { crawlLinks, comparePage } from './website-checks.mjs';
import {
  assertShareable,
  publicProjection,
  clientResponse,
  assertBookable,
  collectionModules,
} from './public-sharing.mjs';
import { Billing } from './billing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const store = await createStore(root);
const billing = new Billing(store);
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(value));
};
const toRecord = (r) => ({
  ...r,
  data: JSON.parse(r.data),
  archived: !!r.archived,
  votes: r.votes || 0,
});
const fail = (status, message) => Object.assign(new Error(message), { status });
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 250000) throw fail(413, 'This request is too large.');
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw fail(400, 'Invalid request format.');
  }
}
const rates = new Map();
function rate(key, max = 20) {
  const now = Date.now();
  let v = rates.get(key);
  if (!v || v.until < now) {
    v = { n: 0, until: now + 900000 };
    rates.set(key, v);
  }
  if (++v.n > max) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
}
const sessionHash = (t) => createHash('sha256').update(t).digest('hex');
async function userFor(req) {
  const token = /\bbw_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  return token ? store.sessionUser(sessionHash(token)) : null;
}
async function own(user, id) {
  const r = await store.getRecord(user.id, id);
  if (!r) throw fail(404, 'This record is not available.');
  return r;
}
const checking = new Set();
async function check(record) {
  if (checking.has(record.id)) throw fail(409, 'A check is already running.');
  checking.add(record.id);
  let result;
  const d = JSON.parse(record.data);
  const domainExpiry =
    record.module === 'expiry' && !d.due ? registrationExpiry(d.registrationDomain) : null;
  try {
    const page = await safeFetch(
      d.url,
      0,
      record.module === 'links' ? new URL(d.url).origin : undefined,
    );
    result = {
      status: page.status,
      ms: page.ms,
      url: page.url,
      ok: page.status >= 200 && page.status < 400,
    };
    if (record.module === 'changes' && result.ok) {
      const previous = await store.latestCheck(record.user_id, record.id);
      Object.assign(result, comparePage(page, d, previous?.result));
    }
    if (record.module === 'expiry') {
      result.certificateExpires = page.certificate;
    }
    if (record.module === 'links') result.links = await crawlLinks(page);
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  try {
    if (record.module === 'expiry') {
      const registration = d.due || (await domainExpiry);
      result.registrationExpires = registration;
      result.registrationSource = d.due ? 'manual' : registration ? 'rdap' : 'unknown';
      result.certificateExpires ??= null;
    }
    return await store.saveCheck(record, result);
  } finally {
    checking.delete(record.id);
  }
}
let vite;
if (process.argv.includes('--dev') || !existsSync(resolve(root, 'dist/index.html'))) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ root, server: { middlewareMode: true }, appType: 'spa' });
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health' && req.method === 'GET') {
    try {
      await store.health();
      json(res, 200, { status: 'ready' });
    } catch {
      json(res, 503, { status: 'unavailable' });
    }
    return;
  }
  if (!url.pathname.startsWith('/api/')) {
    if (vite) {
      vite.middlewares(req, res, () => {
        res.writeHead(404);
        res.end('Not found');
      });
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end('Invalid URL');
      return;
    }
    let path = resolve(root, 'dist', '.' + decoded);
    if (
      !path.startsWith(resolve(root, 'dist') + '/') &&
      !path.startsWith(resolve(root, 'dist') + '\\')
    )
      path = resolve(root, 'dist/index.html');
    if (!existsSync(path) || !extname(path)) path = resolve(root, 'dist/index.html');
    try {
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
          '.xml': 'application/xml',
          '.txt': 'text/plain; charset=utf-8',
        }[extname(path)] || 'application/octet-stream',
      );
      res.end(readFileSync(path));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }
  try {
    if (url.pathname === '/api/billing/paynow/callback' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
        throw fail(415, 'Use form encoding.');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 64000) throw fail(413, 'Payment message is too large.');
      }
      await billing.callback(raw);
      json(res, 200, { received: true });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      const expected =
        process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expected)
        throw fail(403, 'This request came from a different website.');
      if (!req.headers['content-type']?.startsWith('application/json'))
        throw fail(415, 'Use JSON requests.');
    }
    if (url.pathname === '/api/auth' && req.method === 'POST') {
      rate('auth:' + req.socket.remoteAddress);
      const b = await body(req);
      const email = String(b.email || '')
        .trim()
        .toLowerCase();
      const password = String(b.password || '');
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        password.length < 10 ||
        password.length > 128
      )
        throw fail(400, 'Use a valid email and a password of 10–128 characters.');
      let u = await store.userByEmail(email);
      if (b.mode === 'register') {
        if (u) throw fail(400, 'This email is already registered. Sign in instead.');
        const name = String(b.name || '').trim();
        if (!name || name.length > 80)
          throw fail(400, 'Enter a workspace name of 1–80 characters.');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, 64).toString('hex');
        const id = randomUUID();
        await store.createUser({ id, email, name, password: salt + ':' + hash });
        u = { id, email, name };
      } else {
        const salt = u?.password.split(':')[0] || 'not-a-real-user';
        const actual = scryptSync(password, salt, 64);
        if (!u || !timingSafeEqual(actual, Buffer.from(u.password.split(':')[1], 'hex')))
          throw fail(401, 'Email or password is incorrect.');
        if (u.mfa) {
          if (!b.code) {
            json(res, 200, { mfaRequired: true });
            return;
          }
          let next;
          try {
            next = verifyMfa(u, b.code, mfaKey());
          } catch {
            throw fail(503, 'Authenticator verification is unavailable.');
          }
          if (!next) throw fail(401, 'Enter an unused authenticator or recovery code.');
          await store.updateMfa(u, next, false);
        }
      }
      const token = randomBytes(32).toString('hex');
      await store.createSession(sessionHash(token), u, Date.now() + 7 * 86400000);
      json(
        res,
        200,
        { id: u.id, email: u.email, name: u.name },
        {
          'Set-Cookie': `bw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
        },
      );
      return;
    }
    if (url.pathname === '/api/public') {
      const token = req.headers['x-workspace-share'];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
        throw fail(410, 'This link is no longer available. Ask its owner for a new link.');
      const hash = sessionHash(token);
      rate('public:' + hash, 120);
      const share = await store.getShare(hash);
      if (!share)
        throw fail(410, 'This link has expired, was revoked, or has already received a response.');
      const record = await store.getRecord(share.user_id, share.record_id);
      if (share.bookingSlots?.length && record && !record.archived && record.status === 'Active') {
        if (req.method === 'GET') {
          const records = await Promise.all(
            share.bookingSlots.map((slot) => store.getRecord(share.user_id, slot.id)),
          );
          const slots = records
            .flatMap((slot, index) => {
              if (!slot || slot.archived || slot.version !== share.bookingSlots[index].version)
                return [];
              try {
                assertBookable(slot);
              } catch {
                return [];
              }
              const { start, end } = JSON.parse(slot.data);
              return [{ id: slot.id, version: slot.version, start, end }];
            })
            .sort((a, b) => a.start.localeCompare(b.start));
          json(res, 200, {
            module: 'booking',
            brand: share.brand,
            title: 'Choose an appointment',
            expires: share.expires,
            version: share.recordVersion,
            data: {},
            slots,
          });
          return;
        }
        if (req.method === 'POST') {
          const input = await body(req);
          const selected = share.bookingSlots.find(
            (slot) => slot.id === input.slotId && slot.version === input.version,
          );
          if (!selected) throw fail(409, 'Choose an available appointment.');
          const slot = await store.getRecord(share.user_id, selected.id);
          if (!slot || slot.archived || slot.version !== selected.version)
            throw fail(409, 'This appointment is no longer available.');
          const response = clientResponse(slot, input);
          const data = {
            ...JSON.parse(slot.data),
            client: response.name,
            offerSlot: false,
            clientResponse: JSON.stringify(response),
          };
          await store.respondToShare(
            hash,
            slot.version,
            { data: JSON.stringify(data), status: 'Active' },
            selected.id,
          );
          json(res, 200, { received: true, action: 'book' });
          return;
        }
        throw fail(405, 'This action is not available.');
      }
      if (share.bookingSlots?.length)
        throw fail(410, 'This appointment link is no longer available.');
      if (!record || record.archived || record.version !== share.recordVersion)
        throw fail(410, 'The owner updated this document. Ask for a new link.');
      if (record.module === 'booking') assertBookable(record);
      if (req.method === 'GET') {
        const last =
          record.module === 'uptime' ? await store.latestCheck(share.user_id, record.id) : null;
        const projection = publicProjection(record, share, last);
        if (share.collection?.length) {
          const entries = await Promise.all(
            share.collection.map((entry) => store.getRecord(share.user_id, entry.id)),
          );
          if (
            entries.some(
              (entry, index) =>
                !entry ||
                entry.archived ||
                entry.status === 'Cancelled' ||
                entry.module !== record.module ||
                entry.version !== share.collection[index].version,
            )
          )
            throw fail(410, 'This collection was updated. Ask its owner for a fresh link.');
          projection.entries = entries.map((entry) => publicProjection(entry, share));
        }
        json(res, 200, projection);
        return;
      }
      if (req.method === 'POST') {
        const input = await body(req);
        if (input.version !== record.version)
          throw fail(409, 'This document changed. Reload before responding.');
        const response = clientResponse(record, input);
        const data = { ...JSON.parse(record.data), clientResponse: JSON.stringify(response) };
        if (response.action === 'book') {
          data.client = response.name;
          data.offerSlot = false;
        }
        await store.respondToShare(hash, record.version, {
          data: JSON.stringify(data),
          status:
            response.action === 'book'
              ? 'Active'
              : response.action === 'approve'
                ? 'Completed'
                : 'In review',
        });
        json(res, 200, { received: true, action: response.action });
        return;
      }
      throw fail(405, 'This action is not available.');
    }
    const actor = await userFor(req);
    if (!actor) throw fail(401, 'Sign in to open your workspace.');
    let user = actor;
    if (url.pathname === '/api/mfa') {
      const profile = await store.userByEmail(actor.email);
      const key = mfaKey();
      if (req.method === 'GET') {
        json(res, 200, { enabled: Boolean(profile.mfa), available: Boolean(key) });
        return;
      }
      if (req.method !== 'POST') throw fail(405, 'This security action is not available.');
      if (!key) throw fail(503, 'Authenticator setup is unavailable.');
      rate('mfa:' + actor.id, 10);
      const input = await body(req);
      const password = String(input.password || '');
      const [salt, expected] = profile.password.split(':');
      if (
        password.length < 10 ||
        password.length > 128 ||
        !timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'))
      )
        throw fail(401, 'Enter your current password.');
      if (input.action === 'setup' && !profile.mfa) {
        const bytes = randomBytes(20);
        const token = seal(
          { account: actor.id, secret: bytes.toString('hex'), expires: Date.now() + 600000 },
          key,
        );
        json(res, 200, { token, secret: base32(bytes) });
        return;
      }
      if (input.action === 'enable' && !profile.mfa) {
        let enrollment;
        try {
          enrollment = unseal(input.token, key);
        } catch {
          throw fail(400, 'Start authenticator setup again.');
        }
        if (enrollment.account !== actor.id || enrollment.expires <= Date.now())
          throw fail(400, 'Start authenticator setup again.');
        const step = matchStep(enrollment.secret, input.code);
        if (step === null) throw fail(400, 'Enter a current six-digit authenticator code.');
        const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(12).toString('hex'));
        const mfa = {
          secret: seal({ account: actor.id, secret: enrollment.secret }, key),
          step,
          recovery: recoveryCodes.map(recoveryHash),
        };
        await store.updateMfa(profile, mfa, true);
        json(
          res,
          200,
          { recoveryCodes },
          { 'Set-Cookie': 'bw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
        );
        return;
      }
      if (input.action === 'disable' && profile.mfa) {
        if (!verifyMfa(profile, input.code, key))
          throw fail(401, 'Enter an unused authenticator or recovery code.');
        await store.updateMfa(profile, null, true);
        json(
          res,
          200,
          { disabled: true },
          { 'Set-Cookie': 'bw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
        );
        return;
      }
      throw fail(409, 'Authenticator settings have changed. Reload and try again.');
    }
    if (url.pathname === '/api/password' && req.method === 'POST') {
      rate('password:' + user.id, 10);
      const b = await body(req);
      const current = String(b.currentPassword || ''),
        next = String(b.newPassword || '');
      if (current.length < 10 || current.length > 128 || next.length < 10 || next.length > 128)
        throw fail(400, 'Use a password of 10–128 characters.');
      if (current === next)
        throw fail(400, 'Choose a new password that differs from the current one.');
      const profile = await store.userByEmail(user.email),
        [oldSalt, oldHash] = profile.password.split(':');
      if (!timingSafeEqual(scryptSync(current, oldSalt, 64), Buffer.from(oldHash, 'hex')))
        throw fail(400, 'The current password is incorrect.');
      const salt = randomBytes(16).toString('hex'),
        password = salt + ':' + scryptSync(next, salt, 64).toString('hex');
      await store.changePassword(user.email, profile.password, password);
      json(
        res,
        200,
        { changed: true },
        { 'Set-Cookie': 'bw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
      );
      return;
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = /\bbw_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      await store.deleteSession(sessionHash(token));
      json(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': 'bw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
      );
      return;
    }
    if (url.pathname === '/api/team') {
      if (req.method === 'GET') {
        const [members, joined, audit] = await Promise.all([
          store.memberships(actor.id, true),
          store.memberships(actor.id, false),
          store.teamAudit(actor.id),
        ]);
        json(res, 200, { members, joined, audit });
        return;
      }
      if (req.method === 'POST') {
        rate('team:' + actor.id, 30);
        const input = await body(req);
        if (!['viewer', 'editor'].includes(input.role) || input.confirmed !== true)
          throw fail(400, 'Choose a role and confirm workspace access.');
        const email = String(input.email || '')
          .trim()
          .toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw fail(400, 'Enter the account’s email address.');
        const target = await store.userByEmail(email);
        if (!target || target.id === actor.id || input.memberId !== target.id)
          throw fail(400, 'The email and account ID must match another existing account.');
        await store.setMembership({
          ownerId: actor.id,
          ownerName: actor.name,
          memberId: target.id,
          memberEmail: target.email,
          memberName: target.name,
          role: input.role,
        });
        json(res, 200, { saved: true });
        return;
      }
      if (req.method === 'DELETE') {
        rate('team:' + actor.id, 30);
        const { memberId } = await body(req);
        if (typeof memberId !== 'string' || !/^[a-f0-9-]{36}$/i.test(memberId))
          throw fail(400, 'Choose a member.');
        await store.removeMembership(actor.id, memberId);
        json(res, 200, { removed: true });
        return;
      }
      throw fail(405, 'This team action is not available.');
    }
    const selected = req.headers['x-workspace'];
    let role = 'owner';
    if (selected && selected !== actor.id) {
      if (typeof selected !== 'string' || !/^[a-f0-9-]{36}$/i.test(selected))
        throw fail(403, 'This workspace is not available.');
      const membership = await store.membership(selected, actor.id);
      if (!membership || !['viewer', 'editor'].includes(membership.role))
        throw fail(403, 'This workspace is not available.');
      role = membership.role;
      const read =
        req.method === 'GET' &&
        (url.pathname === '/api/state' || /^\/api\/records\/[\w-]+\/revisions$/.test(url.pathname));
      const edit =
        role === 'editor' &&
        ((req.method === 'POST' && url.pathname === '/api/records') ||
          (req.method === 'PATCH' && /^\/api\/records\/[\w-]+$/.test(url.pathname)));
      if (!read && !edit) throw fail(403, 'Only the workspace owner can perform this action.');
      user = { id: selected, name: membership.ownerName };
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const state = await store.state(user.id);
      json(res, 200, {
        user: actor,
        workspace: { id: user.id, name: user.name, role },
        features: { ai: role === 'owner' && Boolean(aiConfig(actor.id)) },
        records: state.records.map(toRecord),
        checks: state.checks,
        storage:
          process.env.STORAGE_BACKEND === 'dynamodb' ? 'Amazon DynamoDB' : 'Local server database',
      });
      return;
    }
    if (url.pathname === '/api/billing' && req.method === 'GET') {
      json(res, 200, await billing.summary(user.id));
      return;
    }
    if (url.pathname === '/api/billing/checkout' && req.method === 'POST') {
      rate('billing:' + user.id, 10);
      json(res, 200, await billing.checkout(user, await body(req)));
      return;
    }
    const paymentMatch = /^\/api\/billing\/([A-Za-z0-9]{32})\/(check|resume)$/.exec(url.pathname);
    if (paymentMatch && req.method === 'POST') {
      rate('billing-check:' + user.id, 30);
      if (paymentMatch[2] === 'check')
        json(res, 200, await billing.reconcile(paymentMatch[1], user.id));
      else {
        const order = await store.getPayment(paymentMatch[1]);
        if (!order || order.userId !== user.id) throw fail(404, 'Purchase not found.');
        if (
          !order.browserURL ||
          !['created', 'sent'].includes(order.status) ||
          order.mode !== billing.config.mode ||
          order.integrationId !== billing.config.id
        )
          throw fail(409, 'This checkout is no longer available.');
        const { paynowURL } = await import('./paynow.mjs');
        json(res, 200, { url: paynowURL(order.browserURL, 'browser') });
      }
      return;
    }
    if (url.pathname === '/api/import' && req.method === 'POST') {
      rate('import:' + actor.id, 30);
      const { records, requestKey } = await body(req);
      if (
        !Array.isArray(records) ||
        records.length < 1 ||
        records.length > 20 ||
        typeof requestKey !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(requestKey)
      )
        throw fail(400, 'Select 1 to 20 records to import.');
      const batch = records.map((record, index) => {
        try {
          const data = { ...record?.data, emailReminder: false };
          return {
            ...validateRecord(record?.module, { title: record?.title, status: 'Draft', data }),
            module: record.module,
          };
        } catch (error) {
          throw fail(400, 'Record ' + (index + 1) + ': ' + error.message);
        }
      });
      await store.createRecordBatch(
        user.id,
        batch,
        requestKey,
        sessionHash(JSON.stringify({ kind: 'import', batch })),
      );
      json(res, 201, { count: batch.length });
      return;
    }
    if (url.pathname === '/api/booking-series' && req.method === 'POST') {
      rate('booking-series:' + actor.id, 10);
      const input = await body(req);
      if (
        !Array.isArray(input.slots) ||
        input.slots.length < 2 ||
        input.slots.length > 13 ||
        typeof input.requestKey !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(input.requestKey)
      )
        throw fail(400, 'Choose 2 to 13 slots.');
      let records;
      try {
        records = input.slots.map((slot) => {
          const record = validateRecord('booking', {
            title: input.title,
            status: 'Active',
            data: {
              client: 'Available slot',
              offerSlot: true,
              start: slot.start,
              end: slot.end,
              bufferMinutes: input.bufferMinutes,
            },
          });
          if (Date.parse(record.data.start) <= Date.now())
            throw new Error('All slots must start in the future.');
          return { ...record, module: 'booking' };
        });
      } catch (error) {
        throw fail(400, error.message);
      }
      await store.createRecordBatch(
        user.id,
        records,
        input.requestKey,
        sessionHash(JSON.stringify({ kind: 'booking-series', records })),
      );
      json(res, 201, { count: records.length });
      return;
    }
    if (url.pathname === '/api/records' && req.method === 'POST') {
      const b = await body(req);
      if (role !== 'owner' && b.module === 'invoices' && b.data?.emailReminder)
        throw fail(403, 'Only the workspace owner can schedule invoice emails.');
      let record;
      try {
        record = validateRecord(b.module, b);
      } catch (e) {
        throw fail(400, e.message);
      }
      const requestKey =
        typeof b.requestKey === 'string' && /^[a-f0-9-]{36}$/.test(b.requestKey)
          ? b.requestKey
          : null;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ module: b.module, ...record }))
        .digest('hex');
      const saved = await store.createRecord(
        user.id,
        b.module,
        record,
        requestKey,
        requestHash,
        role === 'editor' ? actor.id : undefined,
      );
      json(res, saved.replayed ? 200 : 201, toRecord(saved.record));
      return;
    }
    const match =
      /^\/api\/records\/([\w-]+)(?:\/(check|vote|share|convert|revisions|draft|renew))?$/.exec(
        url.pathname,
      );
    if (match) {
      const r = await own(user, match[1]);
      if (match[2] === 'renew' && req.method === 'POST') {
        if (!['equipment', 'licences'].includes(r.module) || r.archived || r.status === 'Cancelled')
          throw fail(400, 'This record cannot be renewed.');
        const input = await body(req);
        const data = JSON.parse(r.data);
        const days = Number(data.repeatDays);
        const completed =
          typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
            ? Date.parse(input.date + 'T00:00:00Z')
            : NaN;
        if (
          !Number.isFinite(completed) ||
          new Date(completed).toISOString().slice(0, 10) !== input.date ||
          completed > Date.now() + 86400000 ||
          completed < Date.now() - 365 * 86400000 ||
          !Number.isInteger(days) ||
          days < 1 ||
          days > 3660
        )
          throw fail(400, 'Choose a valid completion date and configure the repeat interval.');
        if (data.lastCompleted && data.lastCompleted >= input.date)
          throw fail(409, 'Choose a date after the last recorded completion.');
        data.lastCompleted = input.date;
        data.due = new Date(completed + days * 86400000).toISOString().slice(0, 10);
        json(
          res,
          200,
          toRecord(
            await store.updateRecord(user.id, r.id, input.version, {
              data: JSON.stringify(data),
              status: 'Active',
            }),
          ),
        );
        return;
      }
      if (match[2] === 'draft' && req.method === 'POST') {
        rate('draft:' + actor.id, 5);
        json(res, 200, await draftRecord(r, await body(req), aiConfig(actor.id)));
        return;
      }
      if (match[2] === 'revisions' && req.method === 'GET') {
        if (r.module !== 'proposals') throw fail(404, 'Quote history is unavailable.');
        json(res, 200, (await store.quoteRevisions(user.id, r.id)).map(toRecord));
        return;
      }
      if (match[2] === 'share') {
        if (req.method === 'GET') {
          const share = await store.shareForRecord(user.id, r.id);
          json(res, 200, {
            active:
              !!share &&
              share.expires > Date.now() &&
              (share.recordVersion === r.version ||
                (share.bookingSlots?.length && r.status === 'Active')) &&
              !r.archived,
            expires: share?.expires,
          });
          return;
        }
        if (req.method === 'POST') {
          await billing.requirePro(user.id);
          const b = await body(req);
          assertShareable(r);
          if (b.confirmed !== true)
            throw fail(400, 'Confirm that this document may be shared before creating a link.');
          if (b.version !== r.version)
            throw fail(409, 'This record changed. Refresh before sharing.');
          let collection;
          let bookingSlots;
          if (b.collection !== undefined) {
            if (
              (!collectionModules.includes(r.module) && r.module !== 'booking') ||
              !Array.isArray(b.collection) ||
              b.collection.length > 12 ||
              b.collection.some(
                (id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || id === r.id,
              ) ||
              new Set(b.collection).size !== b.collection.length
            )
              throw fail(400, 'Choose up to 12 additional records of the same type.');
            const entries = await Promise.all(
              b.collection.map((id) => store.getRecord(user.id, id)),
            );
            if (
              entries.some(
                (entry) =>
                  !entry ||
                  entry.module !== r.module ||
                  entry.archived ||
                  entry.status === 'Cancelled',
              )
            )
              throw fail(400, 'One or more records cannot be included.');
            if (r.module === 'booking' && entries.length) {
              entries.forEach(assertBookable);
              bookingSlots = [r, ...entries].map((entry) => ({
                id: entry.id,
                version: entry.version,
              }));
            } else collection = entries.map((entry) => ({ id: entry.id, version: entry.version }));
          }
          const days = Number(b.days ?? 7);
          if (![1, 7, 30].includes(days)) throw fail(400, 'Choose a supported link expiry.');
          const token = randomBytes(32).toString('hex');
          const quoteExpiry = r.module === 'proposals' && JSON.parse(r.data).due;
          const expires = Math.min(
            r.module === 'booking' && !bookingSlots
              ? Date.parse(JSON.parse(r.data).start)
              : Infinity,
            Date.now() + days * 86400000,
            quoteExpiry ? Date.parse(quoteExpiry + 'T00:00:00Z') + 86400000 : Infinity,
          );
          if (expires <= Date.now())
            throw fail(400, 'This quote has expired. Update its expiry date before sharing.');
          await store.createShare(user.id, r.id, r.version, {
            hash: sessionHash(token),
            user_id: user.id,
            record_id: r.id,
            brand: user.name,
            recordVersion: r.version,
            ...(collection?.length ? { collection } : {}),
            ...(bookingSlots ? { bookingSlots } : {}),
            expires,
          });
          json(res, 201, { token, expires });
          return;
        }
        if (req.method === 'DELETE') {
          await store.revokeShare(user.id, r.id);
          json(res, 200, { revoked: true });
          return;
        }
      }
      if (match[2] === 'convert' && req.method === 'POST') {
        await billing.requirePro(user.id);
        if (r.module !== 'proposals') throw fail(400, 'Only proposals can become invoice drafts.');
        const b = await body(req);
        if (b.version !== r.version) throw fail(409, 'This proposal changed. Refresh it first.');
        const source = JSON.parse(r.data);
        let record;
        try {
          record = validateRecord('invoices', {
            title: r.title + ' — invoice',
            status: 'Draft',
            data: { ...source, paid: '0', due: '' },
          });
        } catch (e) {
          throw fail(400, e.message);
        }
        const key =
          typeof b.requestKey === 'string' && /^[a-f0-9-]{36}$/.test(b.requestKey)
            ? b.requestKey
            : null;
        const saved = await store.createRecord(
          user.id,
          'invoices',
          record,
          key,
          sessionHash(`invoice:${r.id}:${r.version}`),
        );
        json(res, saved.replayed ? 200 : 201, toRecord(saved.record));
        return;
      }
      if (match[2] === 'check' && req.method === 'POST') {
        if (!['uptime', 'links', 'changes', 'expiry'].includes(r.module))
          throw fail(400, 'This tool does not run website checks.');
        rate('checks:' + user.id, 30);
        json(res, 200, await check(r));
        return;
      }
      if (match[2] === 'vote' && req.method === 'POST') {
        if (r.module !== 'feedback') throw fail(400, 'Only feedback can receive votes.');
        await store.vote(user.id, r.id);
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === 'PATCH' && !match[2]) {
        const b = await body(req);
        if (
          role !== 'owner' &&
          (typeof b.archived === 'boolean' ||
            (r.module === 'invoices' &&
              (JSON.parse(r.data).emailReminder || b.data?.emailReminder)))
        )
          throw fail(
            403,
            'Only the workspace owner can archive records or manage scheduled invoice emails.',
          );
        if (b.version !== r.version)
          throw fail(
            409,
            'This record changed in another window. Close and reopen it before saving.',
          );
        let patch;
        if (b.title === undefined && typeof b.archived === 'boolean') {
          patch = { archived: b.archived };
        } else {
          let record;
          try {
            record = validateRecord(r.module, b);
          } catch (e) {
            throw fail(400, e.message);
          }
          const existing = JSON.parse(r.data);
          if (existing.clientResponse) record.data.clientResponse = existing.clientResponse;
          if (existing.lastCompleted) record.data.lastCompleted = existing.lastCompleted;
          patch = { title: record.title, status: record.status, data: JSON.stringify(record.data) };
        }
        const updated = await store.updateRecord(
          user.id,
          r.id,
          b.version,
          patch,
          role === 'editor' ? actor.id : undefined,
        );
        json(res, 200, toRecord(updated));
        return;
      }
    }
    throw fail(404, 'This action is not available.');
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || 500, {
        error: e.status ? e.message : 'Something went wrong. Please try again.',
      });
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`Business Workspace: http://localhost:${server.address().port}`),
);
let scheduled = false;
let reminderRunning = false;
let nextReminderCycle = 0;
const invoiceMail = reminderConfig();
const interval = setInterval(async () => {
  if (invoiceMail && !reminderRunning && Date.now() >= nextReminderCycle) {
    reminderRunning = true;
    nextReminderCycle = Date.now() + 15 * 60000;
    void sendInvoiceReminders(store, invoiceMail)
      .catch(() => console.error('Invoice reminder processing failed.'))
      .finally(() => {
        reminderRunning = false;
      });
  }
  if (scheduled) return;
  scheduled = true;
  try {
    await store.cleanup();
    for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key);
    const failures = await runMonitorCycle(store, check);
    if (failures)
      console.error(`${failures} monitor checks failed and will retry on the next cycle.`);
  } catch (e) {
    console.error('Scheduled checks will retry on the next cycle.');
  } finally {
    scheduled = false;
  }
}, 60000);
interval.unref();
process.on('SIGTERM', () => {
  clearInterval(interval);
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
});
