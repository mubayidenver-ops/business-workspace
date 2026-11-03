import { resolve } from 'node:path';
export async function createStore(root) {
  const backend = process.env.STORAGE_BACKEND || 'sqlite';
  if (backend === 'dynamodb') {
    const { DynamoStore } = await import('./dynamodb.mjs');
    const store = new DynamoStore();
    try {
      await store.health();
    } catch (e) {
      await store.close();
      throw new Error(
        'DynamoDB connection failed. Check the table, region, IAM permissions and server-side credentials.',
        { cause: e },
      );
    }
    return store;
  }
  if (backend !== 'sqlite') throw new Error('STORAGE_BACKEND must be sqlite or dynamodb.');
  const { SQLiteStore } = await import('./sqlite.mjs');
  return new SQLiteStore(process.env.DATA_DIR || resolve(root, 'data'));
}
