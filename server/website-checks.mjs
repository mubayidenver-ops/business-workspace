import { createHash } from 'node:crypto';
import { safeFetch } from './network.mjs';

function linkTargets(page, origin) {
  const links = new Set();
  for (const match of page.body.matchAll(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    const href = (match[1] ?? match[2] ?? match[3]).replace(/&amp;/gi, '&');
    if (!href || href.startsWith('#') || href.length > 512) continue;
    try {
      const url = new URL(href, page.url);
      url.hash = '';
      if (url.origin === origin && !url.username && !url.password && url.href.length <= 512)
        links.add(url.href);
    } catch {
      // Malformed hrefs cannot be requested.
    }
    if (links.size >= 60) break;
  }
  return links;
}

export async function crawlLinks(first, fetchPage = safeFetch) {
  const signal = AbortSignal.timeout(40000);
  const root = new URL(first.url);
  root.hash = '';
  const checked = new Map([[root.href, { url: root.href, status: first.status, sources: [] }]]);
  const pending = new Set();
  function discover(page) {
    if (
      page.status < 200 ||
      page.status >= 300 ||
      (page.contentType && !page.contentType.includes('text/html'))
    )
      return;
    for (const url of linkTargets(page, root.origin)) {
      if (!checked.has(url)) {
        if (checked.size >= 21) continue;
        checked.set(url, { url, sources: [] });
        pending.add(url);
      }
      const sources = checked.get(url).sources;
      if (!sources.includes(page.url) && sources.length < 10) sources.push(page.url);
    }
  }
  discover(first);
  while (pending.size) {
    const batch = [...pending].slice(0, 4);
    batch.forEach((url) => pending.delete(url));
    const pages = await Promise.all(
      batch.map(async (url) => {
        const row = checked.get(url);
        try {
          const page = await fetchPage(url, 0, root.origin, signal);
          row.status = page.status;
          row.finalUrl = page.url;
          return page;
        } catch {
          row.error = 'Unavailable or redirect blocked';
          return null;
        }
      }),
    );
    pages.filter(Boolean).forEach(discover);
  }
  const targets = new Map();
  for (const { finalUrl, ...row } of checked.values()) {
    const target = new URL(finalUrl || row.url);
    target.hash = '';
    if (target.href === root.href && row.status < 400) continue;
    const previous = targets.get(target.href);
    targets.set(target.href, {
      ...row,
      url: target.href,
      sources: [...new Set([...(previous?.sources || []), ...row.sources])].slice(0, 10),
    });
  }
  return [...targets.values()];
}

export function comparePage(page, options, previous) {
  let content = page.body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(?:div|p|h[1-6]|li|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const start = options.regionStart;
  const end = options.regionEnd;
  if (start || end) {
    const from = content.indexOf(start);
    const to = content.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error('The selected text region was not found.');
    content = content.slice(from + start.length, to);
  }
  const ignored = (options.ignoreText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !ignored.some((pattern) => line.includes(pattern)));
  const snapshot = lines.join('\n').slice(0, 16000);
  const fingerprint = createHash('sha256').update(lines.join('\n')).digest('hex');
  const scope = createHash('sha256')
    .update(JSON.stringify([options.url, start, end, ignored]))
    .digest('hex');
  const changed = previous?.scope === scope && previous.fingerprint !== fingerprint;
  const result = { scope, snapshot, fingerprint, changed };
  if (changed) {
    const old = (previous.snapshot || '').split('\n');
    const next = snapshot.split('\n');
    let i = 0;
    while (i < Math.max(old.length, next.length) && old[i] === next[i]) i++;
    result.diff = {
      before: old
        .slice(i, i + 5)
        .join('\n')
        .slice(0, 1500),
      after: next
        .slice(i, i + 5)
        .join('\n')
        .slice(0, 1500),
    };
  }
  return result;
}
