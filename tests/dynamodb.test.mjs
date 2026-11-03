import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DynamoStore } from '../server/storage/dynamodb.mjs';
import { localDynamoFixture } from './dynamo-support.mjs';
test(
  'DynamoDB persistence and concurrent writes',
  { skip: !process.env.DYNAMODB_TEST_ENDPOINT },
  async (t) => {
    const fixture = await localDynamoFixture();
    const store = new DynamoStore({
      table: fixture.table,
      endpoint: fixture.endpoint,
      region: 'eu-north-1',
    });
    t.after(async () => {
      await store.close();
      await fixture.close();
    });
    await store.health();
    const user = {
      id: randomUUID(),
      email: 'owner@example.com',
      name: 'Owner',
      password: 'salt:hash',
    };
    await store.createUser(user);
    await t.test('email uniqueness is enforced atomically', async () => {
      await assert.rejects(
        () => store.createUser({ ...user, id: randomUUID() }),
        (e) => e.status === 400,
      );
      assert.equal((await store.userByEmail(user.email)).id, user.id);
    });
    await t.test('expired sessions cannot authenticate before TTL deletion', async () => {
      await store.createSession('expired', user, Date.now() - 1000);
      assert.equal(await store.sessionUser('expired'), null);
      await store.createSession('valid', user, Date.now() + 60000);
      assert.deepEqual(await store.sessionUser('valid'), {
        id: user.id,
        email: user.email,
        name: user.name,
      });
      await store.deleteSession('valid');
      assert.equal(await store.sessionUser('valid'), null);
    });
    const project = { title: 'Project', status: 'Active', data: { amount: '100', cost: '20' } };
    await t.test('simultaneous idempotent requests save only one record', async () => {
      const key = randomUUID();
      const results = await Promise.all([
        store.createRecord(user.id, 'projects', project, key, 'hash'),
        store.createRecord(user.id, 'projects', project, key, 'hash'),
      ]);
      assert.equal(results[0].record.id, results[1].record.id);
      assert.equal((await store.state(user.id)).records.length, 1);
    });
    await t.test('simultaneous overlapping bookings cannot both commit', async () => {
      const b = {
        title: 'Meeting',
        status: 'Active',
        data: { client: 'A', start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T11:00:00.000Z' },
      };
      const r = await Promise.allSettled([
        store.createRecord(user.id, 'booking', b, null, 'a'),
        store.createRecord(user.id, 'booking', b, null, 'b'),
      ]);
      assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(r.find((x) => x.status === 'rejected').reason.status, 409);
    });
    await t.test('stale edits are rejected across independent database clients', async () => {
      const original = (await store.state(user.id)).records.find((r) => r.module === 'projects');
      const other = new DynamoStore({
        table: fixture.table,
        endpoint: fixture.endpoint,
        region: 'eu-north-1',
      });
      try {
        const results = await Promise.allSettled([
          store.updateRecord(user.id, original.id, original.version, { title: 'A' }),
          other.updateRecord(user.id, original.id, original.version, { title: 'B' }),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
      } finally {
        await other.close();
      }
    });
    await t.test('monitor registry follows archive and restore', async () => {
      let r = (
        await store.createRecord(
          user.id,
          'uptime',
          { title: 'Site', status: 'Active', data: { url: 'https://example.com' } },
          null,
          'monitor',
        )
      ).record;
      assert.equal((await store.monitors()).length, 1);
      r = await store.updateRecord(user.id, r.id, r.version, { archived: true });
      assert.equal((await store.monitors()).length, 0);
      await store.updateRecord(user.id, r.id, r.version, { archived: false });
      assert.equal((await store.monitors()).length, 1);
    });
    await t.test('restoring a booking rechecks conflicts', async () => {
      let booking = (await store.state(user.id)).records.find((r) => r.module === 'booking');
      booking = await store.updateRecord(user.id, booking.id, booking.version, { archived: true });
      await store.createRecord(
        user.id,
        'booking',
        { title: 'Replacement', status: 'Active', data: JSON.parse(booking.data) },
        null,
        'replacement',
      );
      await assert.rejects(
        () => store.updateRecord(user.id, booking.id, booking.version, { archived: false }),
        (e) => e.status === 409,
      );
    });
    await t.test('history and records remain isolated by workspace', async () => {
      const second = { ...user, id: randomUUID(), email: 'second@example.com' };
      await store.createUser(second);
      const r = (await store.state(user.id)).records[0];
      await store.saveCheck(r, { ok: true, status: 200 });
      assert.equal((await store.state(second.id)).checks.length, 0);
      assert.equal(await store.getRecord(second.id, r.id), null);
      assert.equal((await store.latestCheck(user.id, r.id)).result.status, 200);
    });
    await t.test('shared links expire and concurrent responses cannot both commit', async () => {
      const record = (
        await store.createRecord(
          user.id,
          'approvals',
          {
            title: 'Review',
            status: 'In review',
            data: { client: 'Client', notes: 'Review this' },
          },
          null,
          'review',
        )
      ).record;
      const expired = {
        hash: 'expired-share',
        user_id: user.id,
        record_id: record.id,
        recordVersion: record.version,
        brand: 'Owner',
        expires: Date.now() - 1000,
      };
      await store.createShare(user.id, record.id, record.version, expired);
      assert.equal(await store.getShare(expired.hash), null);
      const share = { ...expired, hash: 'active-share', expires: Date.now() + 60000 };
      await store.createShare(user.id, record.id, record.version, share);
      const answers = await Promise.allSettled([
        store.respondToShare(share.hash, record.version, {
          status: 'Completed',
          data: record.data,
        }),
        store.respondToShare(share.hash, record.version, {
          status: 'In review',
          data: record.data,
        }),
      ]);
      assert.equal(answers.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok([409, 410].includes(answers.find((r) => r.status === 'rejected').reason.status));
      assert.equal(await store.getShare(share.hash), null);
    });
    await t.test('queries read every page without scans', async () => {
      const shortLimit = await store.query('WORKSPACE#' + user.id, 'RECORD#', { limit: 2 });
      assert.equal(shortLimit.length, 2);
      // Query pagination is forced by >1 MB total payload, not only the client page size.
      for (let i = 0; i < 6; i++)
        await store.createRecord(
          user.id,
          'help',
          { title: 'Large ' + i, status: 'Draft', data: { notes: 'x'.repeat(190000) } },
          null,
          'large' + i,
        );
      assert.equal(
        (await store.state(user.id)).records.filter((r) => r.module === 'help').length,
        6,
      );
    });
  },
);
