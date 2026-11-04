import { fileURLToPath } from 'node:url';
import { createStore } from './storage/index.mjs';
import { createCheckRunner } from './check-runner.mjs';
import { startJobs } from './scheduled-jobs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const store = await createStore(root);
const jobs = startJobs(store, createCheckRunner(store), { unref: false });
console.log('Business Workspace background worker started.');
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await jobs.stop();
  await store.close();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
