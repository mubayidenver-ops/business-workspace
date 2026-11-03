import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byId } from '../shared/tools.mjs';
import { validateRecord } from './validation.mjs';
import { safeFetch } from './network.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.DATA_DIR || resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'workspace.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),module TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,created TEXT NOT NULL,result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS votes(record_id TEXT NOT NULL REFERENCES records(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(record_id,user_id));
CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,hash TEXT NOT NULL,record_id TEXT NOT NULL REFERENCES records(id),PRIMARY KEY(user_id,key));
CREATE INDEX IF NOT EXISTS records_owner ON records(user_id,module);`);
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
  votes: db.prepare('SELECT COUNT(*) AS n FROM votes WHERE record_id=?').get(r.id).n,
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
function userFor(req) {
  const token = /\bbw_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return (
    db
      .prepare(
        'SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
      )
      .get(sessionHash(token), Date.now()) ?? null
  );
}
function own(user, id) {
  const r = db.prepare('SELECT * FROM records WHERE id=? AND user_id=?').get(id, user.id);
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
      const previous = db
        .prepare('SELECT result FROM checks WHERE record_id=? ORDER BY created DESC LIMIT 1')
        .get(record.id);
      const prev = previous ? JSON.parse(previous.result) : null;
      result.changed = !!prev?.fingerprint && prev.fingerprint !== result.fingerprint;
    }
    if (record.module === 'expiry') result.certificateExpires = page.certificate;
    if (record.module === 'links') {
      const hrefs = [...page.body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      const urls = [
        ...new Set(
          hrefs
            .filter((h) => !h.startsWith('#'))
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
  db.prepare('INSERT INTO checks VALUES(?,?,?,?,?)').run(
    randomUUID(),
    record.user_id,
    record.id,
    new Date().toISOString(),
    JSON.stringify(result),
  );
  db.prepare(
    'DELETE FROM checks WHERE record_id=? AND id NOT IN (SELECT id FROM checks WHERE record_id=? ORDER BY created DESC LIMIT 30)',
  ).run(record.id, record.id);
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
      const expected = process.env.APP_URL || `http://${req.headers.host}`;
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
      let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (b.mode === 'register') {
        if (u) throw fail(400, 'This email is already registered. Sign in instead.');
        const name = String(b.name || '').trim();
        if (!name || name.length > 80)
          throw fail(400, 'Enter a workspace name of 1–80 characters.');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, 64).toString('hex');
        const id = randomUUID();
        db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, email, name, salt + ':' + hash);
        u = { id, email, name };
      } else {
        const salt = u?.password.split(':')[0] || 'not-a-real-user';
        const actual = scryptSync(password, salt, 64);
        if (!u || !timingSafeEqual(actual, Buffer.from(u.password.split(':')[1], 'hex')))
          throw fail(401, 'Email or password is incorrect.');
      }
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
        sessionHash(token),
        u.id,
        Date.now() + 7 * 86400000,
      );
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
    const user = userFor(req);
    if (!user) throw fail(401, 'Sign in to open your workspace.');
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = /\bbw_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      db.prepare('DELETE FROM sessions WHERE token=?').run(sessionHash(token));
      json(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': 'bw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
      );
      return;
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      json(res, 200, {
        user,
        records: db
          .prepare('SELECT * FROM records WHERE user_id=? ORDER BY updated DESC LIMIT 1000')
          .all(user.id)
          .map(toRecord),
        checks: db
          .prepare('SELECT * FROM checks WHERE user_id=? ORDER BY created DESC LIMIT 200')
          .all(user.id)
          .map((c) => ({ ...c, result: JSON.parse(c.result) })),
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
      if (requestKey) {
        const previous = db
          .prepare('SELECT * FROM requests WHERE user_id=? AND key=?')
          .get(user.id, requestKey);
        if (previous) {
          if (previous.hash !== requestHash)
            throw fail(
              409,
              'This request was already saved with different details. Close this editor and reopen the saved record.',
            );
          json(res, 200, toRecord(own(user, previous.record_id)));
          return;
        }
      }
      if (db.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id=?').get(user.id).n >= 1000)
        throw fail(400, 'This development release supports 1,000 records per workspace.');
      if (b.module === 'booking' && !['Cancelled', 'Completed'].includes(record.status)) {
        const overlap = db
          .prepare(
            "SELECT data FROM records WHERE user_id=? AND module='booking' AND archived=0 AND status NOT IN ('Cancelled','Completed')",
          )
          .all(user.id)
          .some((r) => {
            const d = JSON.parse(r.data);
            return record.data.start < d.end && record.data.end > d.start;
          });
        if (overlap)
          throw fail(409, 'That time overlaps another appointment. Choose another time.');
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare(
          'INSERT INTO records(id,user_id,module,title,status,data,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          id,
          user.id,
          b.module,
          record.title,
          record.status,
          JSON.stringify(record.data),
          now,
          now,
        );
        if (requestKey)
          db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(
            user.id,
            requestKey,
            requestHash,
            id,
          );
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      json(res, 201, toRecord(own(user, id)));
      return;
    }
    const match = /^\/api\/records\/([\w-]+)(?:\/(check|vote))?$/.exec(url.pathname);
    if (match) {
      const r = own(user, match[1]);
      if (match[2] === 'check' && req.method === 'POST') {
        if (!['uptime', 'links', 'changes', 'expiry'].includes(r.module))
          throw fail(400, 'This tool does not run website checks.');
        rate('checks:' + user.id, 30);
        json(res, 200, await check(r));
        return;
      }
      if (match[2] === 'vote' && req.method === 'POST') {
        if (r.module !== 'feedback') throw fail(400, 'Only feedback can receive votes.');
        db.prepare('INSERT OR IGNORE INTO votes VALUES(?,?)').run(r.id, user.id);
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
        if (b.title === undefined && typeof b.archived === 'boolean') {
          db.prepare(
            'UPDATE records SET archived=?,version=version+1,updated=? WHERE id=? AND user_id=?',
          ).run(b.archived ? 1 : 0, new Date().toISOString(), r.id, user.id);
        } else {
          let record;
          try {
            record = validateRecord(r.module, b);
          } catch (e) {
            throw fail(400, e.message);
          }
          if (
            r.module === 'booking' &&
            !r.archived &&
            !['Cancelled', 'Completed'].includes(record.status)
          ) {
            const overlap = db
              .prepare(
                "SELECT data FROM records WHERE user_id=? AND id<>? AND module='booking' AND archived=0 AND status NOT IN ('Cancelled','Completed')",
              )
              .all(user.id, r.id)
              .some((a) => {
                const d = JSON.parse(a.data);
                return record.data.start < d.end && record.data.end > d.start;
              });
            if (overlap) throw fail(409, 'That time overlaps another appointment.');
          }
          db.prepare(
            'UPDATE records SET title=?,status=?,data=?,version=version+1,updated=? WHERE id=? AND user_id=?',
          ).run(
            record.title,
            record.status,
            JSON.stringify(record.data),
            new Date().toISOString(),
            r.id,
            user.id,
          );
        }
        json(res, 200, toRecord(own(user, r.id)));
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
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key);
    const monitors = db
      .prepare(
        "SELECT * FROM records WHERE archived=0 AND status='Active' AND module IN ('uptime','changes') LIMIT 50",
      )
      .all();
    for (const r of monitors) {
      const last = db
        .prepare('SELECT created FROM checks WHERE record_id=? ORDER BY created DESC LIMIT 1')
        .get(r.id);
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
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
