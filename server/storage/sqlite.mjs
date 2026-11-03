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
CREATE INDEX IF NOT EXISTS records_owner ON records(user_id,module);`);
  }
  async health() {
    this.db.prepare('SELECT 1').get();
  }
  async userByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email=?').get(email);
  }
  async createUser(user) {
    try {
      this.db
        .prepare('INSERT INTO users VALUES(?,?,?,?)')
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
        votes: this.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE record_id=?').get(r.id).n,
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
  async updateRecord(userId, id, version, patch) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = changeRecord(this.records(userId), id, version, patch);
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
  async vote(userId, id) {
    this.db.prepare('INSERT OR IGNORE INTO votes VALUES(?,?)').run(id, userId);
  }
  async latestCheck(userId, id) {
    const c = this.db
      .prepare('SELECT * FROM checks WHERE user_id=? AND record_id=? ORDER BY created DESC LIMIT 1')
      .get(userId, id);
    return c ? { ...c, result: JSON.parse(c.result) } : null;
  }
  async saveCheck(record, result) {
    this.db
      .prepare('INSERT INTO checks VALUES(?,?,?,?,?)')
      .run(
        randomUUID(),
        record.user_id,
        record.id,
        new Date().toISOString(),
        JSON.stringify(result),
      );
    this.db
      .prepare(
        'DELETE FROM checks WHERE record_id=? AND id NOT IN (SELECT id FROM checks WHERE record_id=? ORDER BY created DESC LIMIT 30)',
      )
      .run(record.id, record.id);
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
