import { uptimeResult } from '../uptime.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeRecord, changeRecord, replayRequest, storageError } from './rules.mjs';
export class SQLiteStore {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, 'workspace.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),module TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,created TEXT NOT NULL,result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS votes(record_id TEXT NOT NULL REFERENCES records(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(record_id,user_id));
CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,hash TEXT NOT NULL,record_id TEXT NOT NULL REFERENCES records(id),PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS shares(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,record_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments(reference TEXT PRIMARY KEY,user_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_reminders(user_id TEXT NOT NULL, key TEXT NOT NULL, claimed INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS quote_revisions(user_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id,record_id,version));
CREATE TABLE IF NOT EXISTS public_votes(record_id TEXT NOT NULL, voter TEXT NOT NULL, PRIMARY KEY(record_id,voter));
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS settings(workspace_id TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace_id,key));
CREATE TABLE IF NOT EXISTS pages(hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(workspace_id,kind));
CREATE TABLE IF NOT EXISTS booking_tokens(hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, record_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_owner ON records(user_id,module);`);
    if (!this.db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'security'))
      this.db.exec('ALTER TABLE users ADD COLUMN security TEXT');
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async setSecurity(email, expectedVersion, security) {
    const changed = this.db
      .prepare(
        "UPDATE users SET security=? WHERE email=? AND COALESCE(json_extract(security,'$.version'),0)=?",
      )
      .run(JSON.stringify({ ...security, version: expectedVersion + 1 }), email, expectedVersion);
    if (!changed.changes)
      throw storageError(409, 'Your security settings changed. Reload and try again.');
  }
  async revokeSessions(user) {
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  }
  async deleteAccount(user) {
    this.transaction(() => {
      const id = user.id;
      const recordIds = 'SELECT id FROM records WHERE user_id=?';
      this.db.prepare(`DELETE FROM votes WHERE record_id IN (${recordIds}) OR user_id=?`).run(id, id);
      this.db.prepare(`DELETE FROM public_votes WHERE record_id IN (${recordIds})`).run(id);
      for (const table of ['checks', 'requests', 'invoice_reminders', 'quote_revisions'])
        this.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(id);
      this.db.prepare('DELETE FROM shares WHERE user_id=?').run(id);
      for (const table of ['invites', 'settings', 'pages', 'booking_tokens'])
        this.db.prepare(`DELETE FROM ${table} WHERE workspace_id=?`).run(id);
      this.db.prepare('DELETE FROM members WHERE workspace_id=? OR user_id=?').run(id, id);
      this.db.prepare('DELETE FROM records WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM users WHERE id=?').run(id);
    });
  }
  async createInvite(workspaceId, invite) {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM invites WHERE workspace_id=? AND json_extract(payload,'$.email')=?")
        .run(workspaceId, invite.email);
      if (this.db.prepare('SELECT COUNT(*) n FROM invites WHERE workspace_id=?').get(workspaceId).n >= 25)
        throw storageError(400, 'Revoke an old invitation before adding another.');
      this.db
        .prepare('INSERT INTO invites VALUES(?,?,?)')
        .run(invite.hash, workspaceId, JSON.stringify(invite));
    });
  }
  async invites(workspaceId) {
    return this.db
      .prepare('SELECT payload FROM invites WHERE workspace_id=?')
      .all(workspaceId)
      .map((r) => JSON.parse(r.payload))
      .filter((i) => i.expires > Date.now());
  }
  async getInvite(hash) {
    const row = this.db.prepare('SELECT payload FROM invites WHERE hash=?').get(hash);
    const invite = row ? JSON.parse(row.payload) : null;
    return invite && invite.expires > Date.now() ? invite : null;
  }
  async revokeInvite(workspaceId, hash) {
    this.db.prepare('DELETE FROM invites WHERE workspace_id=? AND hash=?').run(workspaceId, hash);
  }
  async acceptInvite(hash, member) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM invites WHERE hash=?').get(hash);
      const invite = row ? JSON.parse(row.payload) : null;
      if (!invite || invite.expires <= Date.now())
        throw storageError(410, 'This invitation has expired or was revoked.');
      if (this.db.prepare('SELECT COUNT(*) n FROM members WHERE workspace_id=?').get(invite.workspace_id).n >= 25)
        throw storageError(400, 'This workspace has reached its 25-member limit.');
      const payload = { ...member, workspace_id: invite.workspace_id, role: invite.role, workspaceName: invite.workspaceName };
      this.db
        .prepare('INSERT OR REPLACE INTO members VALUES(?,?,?)')
        .run(invite.workspace_id, member.user_id, JSON.stringify(payload));
      this.db.prepare('DELETE FROM invites WHERE hash=?').run(hash);
      return payload;
    });
  }
  async members(workspaceId) {
    return this.db
      .prepare('SELECT payload FROM members WHERE workspace_id=?')
      .all(workspaceId)
      .map((r) => JSON.parse(r.payload));
  }
  async membership(workspaceId, userId) {
    const row = this.db
      .prepare('SELECT payload FROM members WHERE workspace_id=? AND user_id=?')
      .get(workspaceId, userId);
    return row ? JSON.parse(row.payload) : null;
  }
  async memberships(userId) {
    return this.db
      .prepare('SELECT payload FROM members WHERE user_id=?')
      .all(userId)
      .map((r) => JSON.parse(r.payload));
  }
  async setMemberRole(workspaceId, userId, role) {
    const current = await this.membership(workspaceId, userId);
    if (!current) throw storageError(404, 'This member is no longer in the workspace.');
    this.db
      .prepare('UPDATE members SET payload=? WHERE workspace_id=? AND user_id=?')
      .run(JSON.stringify({ ...current, role }), workspaceId, userId);
  }
  async removeMember(workspaceId, userId) {
    this.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(workspaceId, userId);
  }
  async getSetting(workspaceId, key) {
    const row = this.db
      .prepare('SELECT payload FROM settings WHERE workspace_id=? AND key=?')
      .get(workspaceId, key);
    return row ? JSON.parse(row.payload) : null;
  }
  async putSetting(workspaceId, key, value) {
    this.db
      .prepare('INSERT OR REPLACE INTO settings VALUES(?,?,?)')
      .run(workspaceId, key, JSON.stringify(value));
  }
  async pages(workspaceId) {
    return this.db
      .prepare('SELECT payload FROM pages WHERE workspace_id=?')
      .all(workspaceId)
      .map((r) => JSON.parse(r.payload));
  }
  async createPage(workspaceId, page) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM pages WHERE workspace_id=? AND kind=?').run(workspaceId, page.kind);
      this.db
        .prepare('INSERT INTO pages VALUES(?,?,?,?)')
        .run(page.hash, workspaceId, page.kind, JSON.stringify(page));
    });
  }
  async deletePage(workspaceId, kind) {
    this.db.prepare('DELETE FROM pages WHERE workspace_id=? AND kind=?').run(workspaceId, kind);
  }
  async pageByHash(hash) {
    const row = this.db.prepare('SELECT payload FROM pages WHERE hash=?').get(hash);
    return row ? JSON.parse(row.payload) : null;
  }
  async publicVote(workspaceId, recordId, voter) {
    const record = this.db
      .prepare("SELECT id FROM records WHERE id=? AND user_id=? AND module='feedback'")
      .get(recordId, workspaceId);
    if (!record) throw storageError(404, 'This request is no longer on the board.');
    return (
      this.db.prepare('INSERT OR IGNORE INTO public_votes VALUES(?,?)').run(recordId, voter)
        .changes === 1
    );
  }
  async createBookingToken(workspaceId, recordId, hash) {
    this.db.prepare('DELETE FROM booking_tokens WHERE workspace_id=? AND record_id=?').run(workspaceId, recordId);
    this.db.prepare('INSERT INTO booking_tokens VALUES(?,?,?)').run(hash, workspaceId, recordId);
  }
  async bookingToken(hash) {
    return this.db.prepare('SELECT * FROM booking_tokens WHERE hash=?').get(hash) || null;
  }
  async deleteBookingToken(hash) {
    this.db.prepare('DELETE FROM booking_tokens WHERE hash=?').run(hash);
  }
  async health() {
    this.db.prepare('SELECT 1').get();
  }
  async userByEmail(email) {
    const user = this.db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return user;
    return { ...user, security: user.security ? JSON.parse(user.security) : { version: 0 } };
  }
  async createUser(user) {
    try {
      this.db
        .prepare('INSERT INTO users(id,email,name,password) VALUES(?,?,?,?)')
        .run(user.id, user.email, user.name, user.password);
    } catch (e) {
      if (e.message.includes('UNIQUE'))
        throw storageError(400, 'This email is already registered. Sign in instead.');
      throw e;
    }
  }
  async createSession(token, user, expires) {
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, user.id, expires);
  }
  async sessionUser(token) {
    return (
      this.db
        .prepare(
          'SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
        )
        .get(token, Date.now()) || null
    );
  }
  async deleteSession(token) {
    this.db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  }
  async changePassword(email, expectedHash, password) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const user = this.db
        .prepare('SELECT id FROM users WHERE email=? AND password=?')
        .get(email, expectedHash);
      if (!user)
        throw storageError(
          409,
          'Your account changed. Sign in again before changing the password.',
        );
      this.db.prepare('UPDATE users SET password=? WHERE id=?').run(password, user.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  records(userId) {
    return this.db
      .prepare('SELECT * FROM records WHERE user_id=? ORDER BY updated DESC LIMIT 1000')
      .all(userId)
      .map((r) => ({
        ...r,
        archived: !!r.archived,
        votes:
          this.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE record_id=?').get(r.id).n +
          this.db.prepare('SELECT COUNT(*) AS n FROM public_votes WHERE record_id=?').get(r.id).n,
      }));
  }
  async getRecord(userId, id) {
    return this.records(userId).find((r) => r.id === id) || null;
  }
  async state(userId) {
    return {
      records: this.records(userId),
      checks: this.db
        .prepare('SELECT * FROM checks WHERE user_id=? ORDER BY created DESC LIMIT 200')
        .all(userId)
        .map((c) => ({ ...c, result: JSON.parse(c.result) })),
    };
  }
  async createRecord(userId, module, record, key, hash) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const records = this.records(userId);
      const previous = key
        ? this.db.prepare('SELECT * FROM requests WHERE user_id=? AND key=?').get(userId, key)
        : null;
      const replay = replayRequest(previous, hash, records);
      if (replay) {
        this.db.exec('COMMIT');
        return { record: replay, replayed: true };
      }
      const r = makeRecord(userId, module, record, records);
      this.db
        .prepare(
          'INSERT INTO records(id,user_id,module,title,status,data,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(r.id, r.user_id, r.module, r.title, r.status, r.data, r.created, r.updated);
      if (key) this.db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(userId, key, hash, r.id);
      this.db.exec('COMMIT');
      return { record: r, replayed: false };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async quoteRevisions(userId, id) {
    return this.db
      .prepare(
        'SELECT payload FROM quote_revisions WHERE user_id=? AND record_id=? ORDER BY version DESC LIMIT 20',
      )
      .all(userId, id)
      .map((row) => JSON.parse(row.payload));
  }
  async updateRecord(userId, id, version, patch) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const records = this.records(userId);
      const r = changeRecord(records, id, version, patch);
      if (r.module === 'proposals') {
        this.db
          .prepare('INSERT INTO quote_revisions VALUES (?,?,?,?)')
          .run(userId, id, version, JSON.stringify(records.find((row) => row.id === id)));
      }
      this.db
        .prepare(
          'UPDATE records SET title=?,status=?,data=?,archived=?,version=?,updated=? WHERE id=? AND user_id=?',
        )
        .run(r.title, r.status, r.data, r.archived ? 1 : 0, r.version, r.updated, id, userId);
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async vote(workspaceId, id, voterId = workspaceId) {
    this.db.prepare('INSERT OR IGNORE INTO votes VALUES(?,?)').run(id, voterId);
  }
  async latestCheck(userId, id) {
    const c = this.db
      .prepare(
        'SELECT * FROM checks WHERE user_id=? AND record_id=? ORDER BY created DESC, rowid DESC LIMIT 1',
      )
      .get(userId, id);
    return c ? { ...c, result: JSON.parse(c.result) } : null;
  }
  async saveCheck(record, result) {
    const created = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (record.module === 'uptime') {
        const previous = this.db
          .prepare(
            'SELECT result FROM checks WHERE user_id=? AND record_id=? ORDER BY created DESC, rowid DESC LIMIT 1',
          )
          .get(record.user_id, record.id);
        result = uptimeResult(record, result, previous && JSON.parse(previous.result), created);
      }
      this.db
        .prepare('INSERT INTO checks VALUES(?,?,?,?,?)')
        .run(randomUUID(), record.user_id, record.id, created, JSON.stringify(result));
      this.db
        .prepare(
          'DELETE FROM checks WHERE record_id=? AND id NOT IN (SELECT id FROM checks WHERE record_id=? ORDER BY created DESC, rowid DESC LIMIT 30)',
        )
        .run(record.id, record.id);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async invoiceReminders() {
    return this.db
      .prepare(
        "SELECT id,user_id FROM records WHERE module='invoices' AND archived=0 AND status='Active' AND json_extract(data,'$.emailReminder')=1",
      )
      .all();
  }
  async claimInvoiceReminder(userId, key, now) {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO invoice_reminders VALUES (?,?,?,'claimed')")
        .run(userId, key, now).changes === 1
    );
  }
  async finishInvoiceReminder(userId, key, status) {
    this.db
      .prepare('UPDATE invoice_reminders SET status=? WHERE user_id=? AND key=?')
      .run(status, userId, key);
  }
  async monitors() {
    return this.db
      .prepare(
        "SELECT * FROM records WHERE archived=0 AND status='Active' AND module IN ('uptime','changes') LIMIT 50",
      )
      .all();
  }
  async createShare(userId, id, version, share) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const record = this.records(userId).find((r) => r.id === id);
      if (!record || record.version !== version)
        throw storageError(409, 'The record changed. Refresh before sharing.');
      this.db.prepare('DELETE FROM shares WHERE user_id=? AND record_id=?').run(userId, id);
      this.db
        .prepare('INSERT INTO shares VALUES(?,?,?,?)')
        .run(share.hash, userId, id, JSON.stringify(share));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async shareForRecord(userId, id) {
    const s = this.db
      .prepare('SELECT payload FROM shares WHERE user_id=? AND record_id=?')
      .get(userId, id);
    return s ? JSON.parse(s.payload) : null;
  }
  async getShare(hash) {
    const s = this.db.prepare('SELECT payload FROM shares WHERE hash=?').get(hash);
    const share = s ? JSON.parse(s.payload) : null;
    return share && share.expires > Date.now() ? share : null;
  }
  async revokeShare(userId, id) {
    this.db.prepare('DELETE FROM shares WHERE user_id=? AND record_id=?').run(userId, id);
  }
  async respondToShare(hash, version, patch) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT payload FROM shares WHERE hash=?').get(hash);
      const share = row ? JSON.parse(row.payload) : null;
      if (!share || share.expires <= Date.now())
        throw storageError(410, 'This link is no longer available.');
      if (share.recordVersion !== version)
        throw storageError(409, 'This document changed. Request a new link.');
      const r = changeRecord(this.records(share.user_id), share.record_id, version, patch);
      this.db
        .prepare(
          'UPDATE records SET title=?,status=?,data=?,version=?,updated=? WHERE id=? AND user_id=?',
        )
        .run(r.title, r.status, r.data, r.version, r.updated, r.id, share.user_id);
      this.db.prepare('DELETE FROM shares WHERE hash=?').run(hash);
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async payments(userId) {
    return this.db
      .prepare('SELECT payload FROM payments WHERE user_id=?')
      .all(userId)
      .map((r) => JSON.parse(r.payload));
  }
  async getPayment(reference) {
    const row = this.db.prepare('SELECT payload FROM payments WHERE reference=?').get(reference);
    return row ? JSON.parse(row.payload) : null;
  }
  async createPayment(order) {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO payments VALUES(?,?,?,?)')
      .run(order.reference, order.userId, order.version, JSON.stringify(order));
    return { created: result.changes === 1, order: await this.getPayment(order.reference) };
  }
  async updatePayment(reference, version, patch) {
    const current = await this.getPayment(reference);
    if (!current || current.version !== version)
      throw storageError(409, 'Purchase changed. Check its status again.');
    const next = { ...current, ...patch, version: version + 1 };
    const saved = this.db
      .prepare('UPDATE payments SET version=?,payload=? WHERE reference=? AND version=?')
      .run(next.version, JSON.stringify(next), reference, version);
    if (!saved.changes) throw storageError(409, 'Purchase changed. Check its status again.');
    return next;
  }
  async cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  }
  async close() {
    this.db.close();
  }
}
