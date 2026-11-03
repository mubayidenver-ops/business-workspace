import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
export async function localDynamoFixture() {
  const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
  if (!endpoint || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname))
    throw new Error('DynamoDB tests require a local endpoint; real AWS is not allowed.');
  const table = 'bw-test-' + randomUUID();
  const client = new DynamoDBClient({
    endpoint,
    region: 'eu-north-1',
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 10000, throwOnRequestTimeout: true },
    credentials: { accessKeyId: 'localtest', secretAccessKey: 'localtest' },
  });
  await client.send(
    new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PROVISIONED',
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    }),
  );
  return {
    table,
    endpoint,
    async close() {
      await client.send(new DeleteTableCommand({ TableName: table }));
      client.destroy();
    },
  };
}
