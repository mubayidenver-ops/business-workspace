import { reminderCandidate } from '../invoice-reminders.mjs';
import { uptimeResult } from '../uptime.mjs';
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
import {
  makeRecord,
  changeRecord,
  replayRequest,
  isMonitor,
  storageError,
  sharedSlotRecord,
} from './rules.mjs';

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
      requestHandler: {
        connectionTimeout: 3000,
        requestTimeout: 10000,
        throwOnRequestTimeout: true,
      },
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
  async membership(ownerId, memberId) {
    return omitKeys(await this.get(workspace(ownerId), 'MEMBER#' + memberId));
  }
  async memberships(id, byOwner) {
    return (await this.query(workspace(id), byOwner ? 'MEMBER#' : 'JOINED#')).map(omitKeys);
  }
  async teamAudit(ownerId) {
    return (
      await this.query(workspace(ownerId), 'TEAM_AUDIT#', { limit: 20, descending: true })
    ).map(omitKeys);
  }
  teamAuditWrite(ownerId, memberId, action) {
    const created = new Date().toISOString();
    return {
      Put: {
        TableName: this.table,
        Item: {
          pk: workspace(ownerId),
          sk: 'TEAM_AUDIT#' + created + '#' + randomUUID(),
          created,
          memberId,
          action,
        },
      },
    };
  }
  async setMembership(entry) {
    return this.mutate(entry.ownerId, () => ({
      items: [
        {
          Put: {
            TableName: this.table,
            Item: { ...entry, pk: workspace(entry.ownerId), sk: 'MEMBER#' + entry.memberId },
          },
        },
        {
          Put: {
            TableName: this.table,
            Item: { ...entry, pk: workspace(entry.memberId), sk: 'JOINED#' + entry.ownerId },
          },
        },
        this.teamAuditWrite(entry.ownerId, entry.memberId, entry.role),
      ],
    }));
  }
  async removeMembership(ownerId, memberId) {
    return this.mutate(ownerId, () => ({
      items: [
        {
          Delete: {
            TableName: this.table,
            Key: { pk: workspace(ownerId), sk: 'MEMBER#' + memberId },
          },
        },
        {
          Delete: {
            TableName: this.table,
            Key: { pk: workspace(memberId), sk: 'JOINED#' + ownerId },
          },
        },
        this.teamAuditWrite(ownerId, memberId, 'revoked'),
      ],
    }));
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
          credentialVersion: user.credentialVersion || 0,
          expires,
          ttl: Math.floor(expires / 1000),
        },
      }),
    );
  }
  async sessionUser(token) {
    const session = await this.get(`SESSION#${token}`, 'SESSION');
    if (!session || session.expires <= Date.now()) return null;
    const profile = await this.userByEmail(session.user.email);
    return profile &&
      profile.id === session.user.id &&
      (profile.credentialVersion || 0) === (session.credentialVersion || 0)
      ? session.user
      : null;
  }
  async deleteSession(token) {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: `SESSION#${token}`, sk: 'SESSION' } }),
    );
  }
  async updateMfa(profile, mfa, invalidate) {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            ...profile,
            pk: 'ACCOUNT#' + profile.email,
            sk: 'PROFILE',
            mfa,
            securityRevision: (profile.securityRevision || 0) + 1,
            credentialVersion: (profile.credentialVersion || 0) + Number(invalidate),
          },
          ConditionExpression:
            '#password = :expected AND (attribute_not_exists(securityRevision) OR securityRevision = :revision)',
          ExpressionAttributeNames: { '#password': 'password' },
          ExpressionAttributeValues: {
            ':expected': profile.password,
            ':revision': profile.securityRevision || 0,
          },
        }),
      );
    } catch (error) {
      if (collision(error)) throw storageError(409, 'Sign-in settings changed. Try again.');
      throw error;
    }
  }
  async changePassword(email, expectedHash, password) {
    const profile = await this.userByEmail(email);
    if (!profile || profile.password !== expectedHash)
      throw storageError(409, 'Your account changed. Sign in again before changing the password.');
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            pk: `ACCOUNT#${email}`,
            sk: 'PROFILE',
            ...profile,
            password,
            credentialVersion: (profile.credentialVersion || 0) + 1,
            securityRevision: (profile.securityRevision || 0) + 1,
          },
          ConditionExpression:
            '#password = :expected AND (attribute_not_exists(securityRevision) OR securityRevision = :revision)',
          ExpressionAttributeNames: { '#password': 'password' },
          ExpressionAttributeValues: {
            ':expected': expectedHash,
            ':revision': profile.securityRevision || 0,
          },
        }),
      );
    } catch (e) {
      if (collision(e))
        throw storageError(
          409,
          'Your account changed. Sign in again before changing the password.',
        );
      throw e;
    }
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
    if (record.module === 'invoices') {
      const Key = { pk: 'INVOICE_REMINDERS', sk: record.user_id + '#' + record.id };
      result.push(
        reminderCandidate(record)
          ? {
              Put: {
                TableName: this.table,
                Item: { ...Key, user_id: record.user_id, id: record.id },
              },
            }
          : { Delete: { TableName: this.table, Key } },
      );
    }
    return result;
  }
  async createRecord(userId, module, record, key, hash, editorId) {
    return this.mutate(userId, async (snapshot) => {
      if (editorId && (await this.membership(userId, editorId))?.role !== 'editor')
        throw storageError(403, 'Editor access is no longer available.');
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
  async createRecordBatch(userId, inputs, key, hash) {
    return this.mutate(userId, async ({ records }) => {
      const request = await this.get(workspace(userId), 'REQUEST#' + key);
      if (request) {
        const previous = await this.getRecord(userId, request.record_id);
        if (replayRequest(request, hash, previous ? [previous] : [])) return { result: undefined };
      }
      const items = [];
      const existing = [...records];
      let first;
      for (const input of inputs) {
        const record = makeRecord(userId, input.module, input, existing);
        existing.push(record);
        first ||= record;
        items.push(...this.recordWrites(record));
      }
      items.push({
        Put: {
          TableName: this.table,
          Item: { pk: workspace(userId), sk: 'REQUEST#' + key, hash, record_id: first.id },
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      });
      return { items, increment: inputs.length };
    });
  }
  async quoteRevisions(userId, id) {
    return (
      await this.query(workspace(userId), `QUOTE#${id}#`, { limit: 20, descending: true })
    ).map(omitKeys);
  }
  async updateRecord(userId, id, version, patch, editorId) {
    return this.mutate(userId, async ({ records }) => {
      if (editorId && (await this.membership(userId, editorId))?.role !== 'editor')
        throw storageError(403, 'Editor access is no longer available.');
      const record = changeRecord(records, id, version, patch);
      const items = this.recordWrites(record);
      if (record.module === 'proposals')
        items.push({
          Put: {
            TableName: this.table,
            Item: {
              ...records.find((row) => row.id === id),
              pk: workspace(userId),
              sk: 'QUOTE#' + id + '#' + String(version).padStart(12, '0'),
            },
          },
        });
      return { items, result: record };
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
    return item && (!item.ttl || item.ttl > Math.floor(Date.now() / 1000)) ? omitKeys(item) : null;
  }
  async saveCheck(record, result) {
    const pk = workspace(record.user_id);
    const sk = `LATEST#${record.id}`;
    const uptime = record.module === 'uptime';
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = uptime ? await this.get(pk, sk) : null;
      const c = {
        id: randomUUID(),
        user_id: record.user_id,
        record_id: record.id,
        created: new Date().toISOString(),
        result,
        ttl: Math.floor(Date.now() / 1000) + 7 * 86400,
      };
      if (uptime) c.result = uptimeResult(record, result, previous?.result, c.created);
      const latest = { ...c, pk, sk };
      if (uptime) delete latest.ttl;
      try {
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
                  Item: latest,
                  ...(uptime &&
                    (previous
                      ? {
                          ConditionExpression: 'id = :previous',
                          ExpressionAttributeValues: { ':previous': previous.id },
                        }
                      : { ConditionExpression: 'attribute_not_exists(pk)' })),
                },
              },
            ],
          }),
        );
        return c.result;
      } catch (error) {
        if (!uptime || !collision(error) || attempt === 4) throw error;
      }
    }
  }
  async invoiceReminders() {
    return (await this.query('INVOICE_REMINDERS', '')).map(omitKeys);
  }
  async claimInvoiceReminder(userId, key, now) {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: workspace(userId), sk: 'REMINDER#' + key, claimed: now, status: 'claimed' },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return true;
    } catch (error) {
      if (collision(error)) return false;
      throw error;
    }
  }
  async finishInvoiceReminder(userId, key, status) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: workspace(userId), sk: 'REMINDER#' + key, status },
      }),
    );
  }
  async monitors() {
    return (await this.query('MONITORS', '', { limit: 50 })).map(omitKeys);
  }
  async createShare(userId, id, version, share) {
    return this.mutate(userId, async ({ records }) => {
      const record = records.find((r) => r.id === id);
      if (!record || record.version !== version)
        throw storageError(409, 'The record changed. Refresh before sharing.');
      const previous = await this.shareForRecord(userId, id);
      const items = [
        {
          Put: {
            TableName: this.table,
            Item: {
              pk: `SHARE#${share.hash}`,
              sk: 'LINK',
              ...share,
              ttl: Math.floor(share.expires / 1000),
            },
          },
        },
        {
          Put: {
            TableName: this.table,
            Item: {
              pk: workspace(userId),
              sk: `SHARE#${id}`,
              ...share,
              ttl: Math.floor(share.expires / 1000),
            },
          },
        },
      ];
      if (previous)
        items.push({
          Delete: { TableName: this.table, Key: { pk: `SHARE#${previous.hash}`, sk: 'LINK' } },
        });
      return { items, result: undefined };
    });
  }
  async shareForRecord(userId, id) {
    return omitKeys(await this.get(workspace(userId), `SHARE#${id}`));
  }
  async getShare(hash) {
    const share = omitKeys(await this.get(`SHARE#${hash}`, 'LINK'));
    return share && share.expires > Date.now() ? share : null;
  }
  async revokeShare(userId, id) {
    return this.mutate(userId, async () => {
      const previous = await this.shareForRecord(userId, id);
      if (!previous) return { result: undefined };
      return {
        items: [
          { Delete: { TableName: this.table, Key: { pk: `SHARE#${previous.hash}`, sk: 'LINK' } } },
          { Delete: { TableName: this.table, Key: { pk: workspace(userId), sk: `SHARE#${id}` } } },
        ],
        result: undefined,
      };
    });
  }
  async respondToShare(hash, version, patch, slotId) {
    const initial = await this.getShare(hash);
    if (!initial) throw storageError(410, 'This link is no longer available.');
    return this.mutate(initial.user_id, async ({ records }) => {
      const share = await this.getShare(hash);
      if (!share) throw storageError(410, 'This link is no longer available.');
      const record = changeRecord(
        records,
        sharedSlotRecord(records, share, version, slotId),
        version,
        patch,
      );
      if (slotId) return { items: this.recordWrites(record), result: record };
      return {
        items: [
          ...this.recordWrites(record),
          { Delete: { TableName: this.table, Key: { pk: `SHARE#${hash}`, sk: 'LINK' } } },
          {
            Delete: {
              TableName: this.table,
              Key: { pk: workspace(initial.user_id), sk: `SHARE#${record.id}` },
            },
          },
        ],
        result: record,
      };
    });
  }
  async payments(userId) {
    return (await this.query(workspace(userId), 'PAYMENT#')).map(omitKeys);
  }
  async getPayment(reference) {
    return omitKeys(await this.get(`PAYMENT#${reference}`, 'ORDER'));
  }
  async createPayment(order) {
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { pk: `PAYMENT#${order.reference}`, sk: 'ORDER', ...order },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: { pk: workspace(order.userId), sk: `PAYMENT#${order.reference}`, ...order },
              },
            },
          ],
        }),
      );
      return { created: true, order };
    } catch (e) {
      if (!collision(e)) throw e;
      const existing = await this.getPayment(order.reference);
      if (!existing) throw storageError(409, 'Purchase is being created. Try again.');
      return { created: false, order: existing };
    }
  }
  async updatePayment(reference, version, patch) {
    const current = await this.getPayment(reference);
    if (!current || current.version !== version)
      throw storageError(409, 'Purchase changed. Check its status again.');
    const next = { ...current, ...patch, version: version + 1 };
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { pk: `PAYMENT#${reference}`, sk: 'ORDER', ...next },
                ConditionExpression: '#v = :v',
                ExpressionAttributeNames: { '#v': 'version' },
                ExpressionAttributeValues: { ':v': version },
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: { pk: workspace(current.userId), sk: `PAYMENT#${reference}`, ...next },
              },
            },
          ],
        }),
      );
      return next;
    } catch (e) {
      if (collision(e)) throw storageError(409, 'Purchase changed. Check its status again.');
      throw e;
    }
  }
  async cleanup() {
    /* DynamoDB TTL removes expired sessions and history once enabled. */
  }
  async close() {
    this.client.destroy();
  }
}
