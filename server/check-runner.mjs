import { safeFetch } from './network.mjs';
import { registrationExpiry } from './rdap.mjs';
import { crawlLinks, comparePage } from './website-checks.mjs';
import { storageError } from './storage/rules.mjs';
export function createCheckRunner(store) {
  const checking = new Set();
  return async function check(record) {
    if (checking.has(record.id)) throw storageError(409, 'A check is already running.');
    checking.add(record.id);
    let result;
    let d;
    try {
      d = JSON.parse(record.data);
    } catch (error) {
      checking.delete(record.id);
      throw error;
    }
    const domainExpiry =
      record.module === 'expiry' && !d.due ? registrationExpiry(d.registrationDomain) : null;
    try {
      const page = await safeFetch(
        d.url,
        0,
        record.module === 'links' ? new URL(d.url).origin : undefined,
      );
      result = {
        status: page.status,
        ms: page.ms,
        url: page.url,
        ok: page.status >= 200 && page.status < 400,
      };
      if (record.module === 'changes' && result.ok) {
        const previous = await store.latestCheck(record.user_id, record.id);
        Object.assign(result, comparePage(page, d, previous?.result));
      }
      if (record.module === 'expiry') {
        result.certificateExpires = page.certificate;
      }
      if (record.module === 'links') result.links = await crawlLinks(page);
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    try {
      if (record.module === 'expiry') {
        const registration = d.due || (await domainExpiry);
        result.registrationExpires = registration;
        result.registrationSource = d.due ? 'manual' : registration ? 'rdap' : 'unknown';
        result.certificateExpires ??= null;
      }
      return await store.saveCheck(record, result);
    } finally {
      checking.delete(record.id);
    }
  };
}
