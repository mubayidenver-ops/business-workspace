import { reminderConfig, sendInvoiceReminders } from './invoice-reminders.mjs';
import { runMonitorCycle } from './uptime.mjs';

export const jobDefinitions = [
  { name: 'monitors', label: 'Website monitoring', interval: 60000, staleAfter: 10 * 60000 },
  {
    name: 'reminders',
    label: 'Invoice email reminders',
    interval: 15 * 60000,
    staleAfter: 45 * 60000,
  },
];

export function startJobs(store, check, { mail = reminderConfig(), unref = true } = {}) {
  const timers = [];
  const running = new Set();
  let stopped = false;
  for (const job of jobDefinitions) {
    if (job.name === 'reminders' && !mail) continue;
    let active = false;
    function tick() {
      if (stopped || active) return;
      active = true;
      const startedAt = new Date().toISOString();
      const work = (async () => {
        let failures = 0;
        try {
          if (job.name === 'monitors') {
            await store.cleanup().catch(() => {
              failures++;
            });
            failures += await runMonitorCycle(store, check);
          } else failures += await sendInvoiceReminders(store, mail);
        } catch {
          failures++;
        }
        try {
          await store.saveJobRun(job.name, {
            startedAt,
            finishedAt: new Date().toISOString(),
            failures,
          });
        } catch {
          console.error('Could not save background job history for ' + job.name + '.');
        }
        if (failures) console.error(job.name + ' cycle finished with ' + failures + ' failures.');
      })();
      running.add(work);
      void work.finally(() => {
        active = false;
        running.delete(work);
      });
    }
    const timer = setInterval(tick, job.interval);
    if (unref) timer.unref();
    timers.push(timer);
    if (!unref) tick();
  }
  return {
    async stop() {
      stopped = true;
      timers.forEach(clearInterval);
      await Promise.allSettled(running);
    },
  };
}
