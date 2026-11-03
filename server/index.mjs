import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './storage/index.mjs';
import { validateRecord } from './validation.mjs';
import { safeFetch } from './network.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const store = await createStore(root);
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
  try {
    const d = JSON.parse(record.data);
    const page = await safeFetch(d.url);
    result = {
      status: page.status,
      ms: page.ms,
      url: page.url,
      ok: page.status >= 200 && page.status < 400,
    };
    if (record.module === 'changes') {
      result.fingerprint = createHash('sha256').update(page.body).digest('hex');
      const previous = await store.latestCheck(record.user_id, record.id);
      const prev = previous?.result;
      result.changed = !!prev?.fingerprint && prev.fingerprint !== result.fingerprint;
    }
    if (record.module === 'expiry') result.certificateExpires = page.certificate;
    if (record.module === 'links') {
      const hrefs = [...page.body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      const urls = [
        ...new Set(
          hrefs
            .filter((h) => !h.startsWith('#') && h.length <= 2048)
            .map((h) => {
              try {
                const u = new URL(h, page.url);
                return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
              } catch {
                return null;
              }
            })
            .filter(Boolean),
        ),
      ].slice(0, 20);
      result.links = [];
      for (let i = 0; i < urls.length; i += 4) {
        const group = await Promise.all(
          urls.slice(i, i + 4).map(async (url) => {
            try {
              const r = await safeFetch(url);
              return { url, status: r.status };
            } catch {
              return { url, error: 'Unavailable or blocked by safety limits' };
            }
          }),
        );
        result.links.push(...group);
      }
    }
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    checking.delete(record.id);
  }
  await store.saveCheck(record, result);
  return result;
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
    const user = await userFor(req);
    if (!user) throw fail(401, 'Sign in to open your workspace.');
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
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const state = await store.state(user.id);
      json(res, 200, {
        user,
        records: state.records.map(toRecord),
        checks: state.checks,
        storage:
          process.env.STORAGE_BACKEND === 'dynamodb' ? 'Amazon DynamoDB' : 'Local server database',
      });
      return;
    }
    if (url.pathname === '/api/records' && req.method === 'POST') {
      const b = await body(req);
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
      const saved = await store.createRecord(user.id, b.module, record, requestKey, requestHash);
      json(res, saved.replayed ? 200 : 201, toRecord(saved.record));
      return;
    }
    const match = /^\/api\/records\/([\w-]+)(?:\/(check|vote))?$/.exec(url.pathname);
    if (match) {
      const r = await own(user, match[1]);
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
          patch = { title: record.title, status: record.status, data: JSON.stringify(record.data) };
        }
        const updated = await store.updateRecord(user.id, r.id, b.version, patch);
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
const interval = setInterval(async () => {
  if (scheduled) return;
  scheduled = true;
  try {
    await store.cleanup();
    for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key);
    const monitors = await store.monitors();
    for (const r of monitors) {
      const last = await store.latestCheck(r.user_id, r.id);
      if (!last || Date.now() - Date.parse(last.created) > 300000) await check(r);
    }
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
