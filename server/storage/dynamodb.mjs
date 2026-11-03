import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { makeRecord, changeRecord, replayRequest, isMonitor, storageError } from './rules.mjs';

const workspace = (userId) => `WORKSPACE#${userId}`;
const omitKeys = (item) => {
  if (!item) return null;
  const { pk, sk, ttl, ...data } = item;
  return data;
};
const collision = (e) =>
  e.name === 'ConditionalCheckFailedException' ||
  e.name === 'TransactionConflictException' ||
  (e.name === 'TransactionCanceledException' &&
    e.CancellationReasons?.some((r) =>
      ['ConditionalCheckFailed', 'TransactionConflict'].includes(r.Code),
    ));
export class DynamoStore {
  constructor({
    table = process.env.DYNAMODB_TABLE || 'bussiness-workspace',
    region = process.env.AWS_REGION || 'eu-north-1',
    endpoint = process.env.DYNAMODB_ENDPOINT,
  } = {}) {
    if (endpoint && !['test', 'development'].includes(process.env.NODE_ENV))
      throw new Error('DYNAMODB_ENDPOINT is allowed only for local development and tests.');
    if (endpoint && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname))
      throw new Error('The development DynamoDB endpoint must be local.');
    this.table = table;
    this.region = region;
    this.client = new DynamoDBClient({
      region,
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
      ...(endpoint
        ? { endpoint, credentials: { accessKeyId: 'localtest', secretAccessKey: 'localtest' } }
        : {}),
    });
    this.doc = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.validated = false;
  }
  async health() {
    if (!this.validated) {
      const { Table: t } = await this.client.send(
        new DescribeTableCommand({ TableName: this.table }),
      );
      if (
        t?.TableStatus !== 'ACTIVE' ||
        !t.KeySchema?.some((k) => k.AttributeName === 'pk' && k.KeyType === 'HASH') ||
        !t.KeySchema?.some((k) => k.AttributeName === 'sk' && k.KeyType === 'RANGE') ||
        !['pk', 'sk'].every((n) =>
          t.AttributeDefinitions?.some((a) => a.AttributeName === n && a.AttributeType === 'S'),
        )
      )
        throw new Error('DynamoDB needs an Active table with String pk and String sk keys.');
      this.validated = true;
    }
    await this.get('HEALTH', 'READY');
  }
  async get(pk, sk) {
    return (
      (
        await this.doc.send(
          new GetCommand({ TableName: this.table, Key: { pk, sk }, ConsistentRead: true }),
        )
      ).Item || null
    );
  }
  async query(pk, prefix, { limit = Infinity, descending = false } = {}) {
    const result = [];
    let cursor;
    do {
      const response = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: prefix ? '#pk = :pk AND begins_with(#sk, :prefix)' : '#pk = :pk',
          ExpressionAttributeNames: prefix ? { '#pk': 'pk', '#sk': 'sk' } : { '#pk': 'pk' },
          ExpressionAttributeValues: prefix ? { ':pk': pk, ':prefix': prefix } : { ':pk': pk },
          ConsistentRead: true,
          ScanIndexForward: !descending,
          Limit: Number.isFinite(limit) ? Math.min(limit - result.length, 200) : 200,
          ExclusiveStartKey: cursor,
        }),
      );
      result.push(...(response.Items || []));
      cursor = response.LastEvaluatedKey;
    } while (cursor && result.length < limit);
    return result;
  }
  async userByEmail(email) {
    return omitKeys(await this.get(`ACCOUNT#${email}`, 'PROFILE'));
  }
  async createUser(user) {
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { pk: `ACCOUNT#${user.email}`, sk: 'PROFILE', ...user },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: { pk: workspace(user.id), sk: 'META', revision: 0, count: 0 },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
          ],
        }),
      );
    } catch (e) {
      if (collision(e))
        throw storageError(400, 'This email is already registered. Sign in instead.');
      throw e;
    }
  }
  async createSession(token, user, expires) {
    const { id, email, name } = user;
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          pk: `SESSION#${token}`,
          sk: 'SESSION',
          user: { id, email, name },
          expires,
          ttl: Math.floor(expires / 1000),
        },
      }),
    );
  }
  async sessionUser(token) {
    const session = await this.get(`SESSION#${token}`, 'SESSION');
    return session && session.expires > Date.now() ? session.user : null;
  }
  async deleteSession(token) {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: `SESSION#${token}`, sk: 'SESSION' } }),
    );
  }
  async getRecord(userId, id) {
    return omitKeys(await this.get(workspace(userId), `RECORD#${id}`));
  }
  async snapshot(userId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await this.get(workspace(userId), 'META');
      if (!before) throw storageError(503, 'Workspace metadata is unavailable.');
      const records = (await this.query(workspace(userId), 'RECORD#')).map(omitKeys);
      const after = await this.get(workspace(userId), 'META');
      if (after?.revision === before.revision) return { meta: before, records };
    }
    throw storageError(409, 'This workspace is busy. Please try again.');
  }
  async mutate(userId, operation) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const snapshot = await this.snapshot(userId);
      const plan = await operation(snapshot);
      if (!plan.items) return plan.result;
      const meta = {
        ...snapshot.meta,
        revision: snapshot.meta.revision + 1,
        count: snapshot.meta.count + (plan.increment || 0),
      };
      try {
        await this.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.table,
                  Item: meta,
                  ConditionExpression: '#revision = :expected',
                  ExpressionAttributeNames: { '#revision': 'revision' },
                  ExpressionAttributeValues: { ':expected': snapshot.meta.revision },
                },
              },
              ...plan.items,
            ],
          }),
        );
        return plan.result;
      } catch (e) {
        if (!collision(e)) throw e;
        if (attempt === 5)
          throw storageError(409, 'This workspace changed while saving. Please try again.');
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
      }
    }
  }
  recordWrites(record) {
    const result = [
      {
        Put: {
          TableName: this.table,
          Item: { pk: workspace(record.user_id), sk: `RECORD#${record.id}`, ...record },
        },
      },
    ];
    const Key = { pk: 'MONITORS', sk: `${record.user_id}#${record.id}` };
    if (['uptime', 'changes'].includes(record.module))
      result.push(
        isMonitor(record)
          ? { Put: { TableName: this.table, Item: { ...Key, ...record } } }
          : { Delete: { TableName: this.table, Key } },
      );
    return result;
  }
  async createRecord(userId, module, record, key, hash) {
    return this.mutate(userId, async (snapshot) => {
      const previous = key ? await this.get(workspace(userId), `REQUEST#${key}`) : null;
      const replay = previous
        ? replayRequest(
            previous,
            hash,
            [await this.getRecord(userId, previous.record_id)].filter(Boolean),
          )
        : null;
      if (replay) return { result: { record: replay, replayed: true } };
      const r = makeRecord(userId, module, record, snapshot.records);
      const items = this.recordWrites(r);
      if (key)
        items.push({
          Put: {
            TableName: this.table,
            Item: { pk: workspace(userId), sk: `REQUEST#${key}`, hash, record_id: r.id },
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        });
      return { items, increment: 1, result: { record: r, replayed: false } };
    });
  }
  async updateRecord(userId, id, version, patch) {
    return this.mutate(userId, ({ records }) => {
      const record = changeRecord(records, id, version, patch);
      return { items: this.recordWrites(record), result: record };
    });
  }
  async vote(userId, id) {
    return this.mutate(userId, async ({ records }) => {
      const record = records.find((r) => r.id === id);
      if (!record) throw storageError(404, 'This record is not available.');
      if (await this.get(workspace(userId), `VOTE#${id}`)) return { result: undefined };
      return {
        items: [
          {
            Put: {
              TableName: this.table,
              Item: { pk: workspace(userId), sk: `VOTE#${id}` },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          ...this.recordWrites({ ...record, votes: (record.votes || 0) + 1 }),
        ],
        result: undefined,
      };
    });
  }
  async state(userId) {
    const [{ records }, checks] = await Promise.all([
      this.snapshot(userId),
      this.query(workspace(userId), 'CHECK#', { limit: 200, descending: true }),
    ]);
    return {
      records: records.sort((a, b) => b.updated.localeCompare(a.updated)),
      checks: checks.filter((c) => c.ttl > Math.floor(Date.now() / 1000)).map(omitKeys),
    };
  }
  async latestCheck(userId, id) {
    const item = await this.get(workspace(userId), `LATEST#${id}`);
    return item && item.ttl > Math.floor(Date.now() / 1000) ? omitKeys(item) : null;
  }
  async saveCheck(record, result) {
    const c = {
      id: randomUUID(),
      user_id: record.user_id,
      record_id: record.id,
      created: new Date().toISOString(),
      result,
      ttl: Math.floor(Date.now() / 1000) + 7 * 86400,
    };
    await this.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.table,
              Item: { pk: workspace(record.user_id), sk: `CHECK#${c.created}#${c.id}`, ...c },
            },
          },
          {
            Put: {
              TableName: this.table,
              Item: { pk: workspace(record.user_id), sk: `LATEST#${record.id}`, ...c },
            },
          },
        ],
      }),
    );
  }
  async monitors() {
    return (await this.query('MONITORS', '', { limit: 50 })).map(omitKeys);
  }
  async cleanup() {
    /* DynamoDB TTL removes expired sessions and history once enabled. */
  }
  async close() {
    this.client.destroy();
  }
}
