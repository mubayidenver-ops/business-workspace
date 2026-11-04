import { domainToASCII } from 'node:url';
import { safeFetch } from './network.mjs';

const bootstrapUrl = 'https://data.iana.org/rdap/dns.json';
let cache;

export function registrationDomain(value) {
  const input = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (/[\s/:@?#%\\]/.test(input)) return '';
  const domain = domainToASCII(input);
  return domain.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z][a-z0-9-]{1,62})$/.test(domain)
    ? domain
    : '';
}

export async function registrationExpiry(raw, fetchPage = safeFetch) {
  const domain = registrationDomain(raw);
  if (!domain) return null;
  try {
    const signal = AbortSignal.timeout(18000);
    if (!cache || cache.fetchPage !== fetchPage || cache.expires < Date.now()) {
      const page = await fetchPage(bootstrapUrl, 0, new URL(bootstrapUrl).origin, signal);
      if (page.status !== 200) return null;
      const { services } = JSON.parse(page.body);
      if (!Array.isArray(services)) return null;
      cache = { services, fetchPage, expires: Date.now() + 86400000 };
    }
    const suffix = domain.split('.').at(-1);
    const service = cache.services.find(
      ([labels]) => Array.isArray(labels) && labels.includes(suffix),
    );
    const base = service?.[1]?.find((url) => typeof url === 'string' && url.startsWith('https://'));
    if (!base) return null;
    const target = new URL(
      'domain/' + encodeURIComponent(domain),
      base.endsWith('/') ? base : base + '/',
    );
    const page = await fetchPage(target.href, 0, undefined, signal);
    if (page.status !== 200) return null;
    const record = JSON.parse(page.body);
    if (
      record.objectClassName !== 'domain' ||
      registrationDomain(record.ldhName || record.unicodeName) !== domain
    )
      return null;
    const expiration = record.events?.find(
      (event) => event.eventAction === 'expiration',
    )?.eventDate;
    return Number.isFinite(Date.parse(expiration)) ? new Date(expiration).toISOString() : null;
  } catch {
    return null;
  }
}
