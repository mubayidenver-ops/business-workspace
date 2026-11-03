import { spawn } from 'node:child_process';
const processHandle = spawn(
  process.execPath,
  ['--test', 'tests/api.test.mjs', 'tests/dynamodb.test.mjs'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DYNAMODB_TEST_ENDPOINT: process.env.DYNAMODB_TEST_ENDPOINT || 'http://127.0.0.1:8000',
    },
  },
);
processHandle.on('exit', (code) => process.exit(code ?? 1));
