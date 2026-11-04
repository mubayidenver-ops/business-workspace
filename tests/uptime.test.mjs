import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../server/storage/sqlite.mjs';
import { DynamoStore } from '../server/storage/dynamodb.mjs';
import { localDynamoFixture } from './dynamo-support.mjs';
import { validateRecord } from '../server/validation.mjs';
import { checkInterval } from '../server/uptime.mjs';

test('old monitors default to five minutes and new intervals are validated', () => {
  const input = { title: 'Site', status: 'Active', data: { url: 'https://example.com' } };
  const validate = (minutes) =>
    validateRecord('uptime', {
      ...input,
      data: { ...input.data, intervalMinutes: minutes },
    });
  assert.equal(checkInterval({ module: 'uptime', data: JSON.stringify(input.data) }), 300000);
  assert.equal(validate('15').data.intervalMinutes, '15');
  for (const interval of ['0', '4', '5.5', '1441']) assert.throws(() => validate(interval));
});

for (const backend of ['sqlite', 'dynamodb']) {
  test(
    'one outage and one recovery alert per incident on ' + backend,
    {
      skip: backend === 'dynamodb' && !process.env.DYNAMODB_TEST_ENDPOINT,
    },
    async (t) => {
      const dir = await mkdtemp(join(tmpdir(), 'uptime-test-'));
      const fixture = backend === 'dynamodb' ? await localDynamoFixture() : null;
      const store = fixture
        ? new DynamoStore({ table: fixture.table, endpoint: fixture.endpoint })
        : new SQLiteStore(dir);
      t.after(async () => {
        await store.close();
        if (fixture) await fixture.close();
        await rm(dir, { recursive: true, force: true });
      });
      const id = randomUUID();
      await store.createUser({
        id,
        email: 'uptime@example.com',
        name: 'Monitor',
        password: 'test',
      });
      const { record } = await store.createRecord(id, 'uptime', {
        title: 'Site',
        status: 'Active',
        data: { url: 'https://example.com' },
      });
      const fail = () => store.saveCheck(record, { ok: false, status: 503 });
      const recover = () => store.saveCheck(record, { ok: true, status: 200 });
      const failures = await Promise.all([fail(), fail(), fail()]);
      assert.equal(failures.filter((check) => check.transition === 'outage').length, 1);
      assert.equal(new Set(failures.map((check) => check.incident.id)).size, 1);
      const recoveries = await Promise.all([recover(), recover()]);
      const recovery = recoveries.find((check) => check.transition === 'recovery');
      assert.ok(recovery.incident.closed);
      assert.equal(recoveries.filter((check) => check.transition === 'recovery').length, 1);
      assert.equal(recovery.incident.id, failures[0].incident.id);
      assert.equal(
        (await store.state(id)).checks.filter((check) => check.result.transition).length,
        2,
      );
      assert.equal(await store.latestCheck(randomUUID(), record.id), null);
    },
  );
}
