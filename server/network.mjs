import { lookup } from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import { BlockList, isIP } from 'node:net';
const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
])
  blocked.addSubnet(ip, prefix, 'ipv4');
export function publicIPv4(ip) {
  return isIP(ip) === 4 && !blocked.check(ip, 'ipv4');
}
export async function safeFetch(raw, depth = 0) {
  if (depth > 3) throw new Error('Too many redirects.');
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('Only public HTTP/HTTPS websites on standard ports can be checked.');
  const host = url.hostname;
  if (isIP(host) === 6 || host.includes(':') || host.endsWith('.local') || host === 'localhost')
    throw new Error('Local and private websites cannot be checked.');
  const addresses = await Promise.race([
    lookup(host, { all: true, family: 4 }),
    new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Website name lookup timed out.')), 5000);
      timeout.unref();
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error('Local and private websites cannot be checked.');
  const address = addresses[0].address;
  const start = Date.now();
  const result = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(
      url,
      {
        headers: { 'User-Agent': 'BusinessWorkspaceMonitor/0.1', Accept: 'text/html,*/*;q=0.5' },
        lookup: (_h, options, cb) =>
          options.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4),
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        const certificate = res.socket.getPeerCertificate?.()?.valid_to ?? null;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            res.destroy(new Error('Page exceeds the 1 MB check limit.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
            location: res.headers.location,
            certificate,
            url: url.href,
            ms: Date.now() - start,
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('Website did not respond within 8 seconds.')));
    req.on('error', reject);
    const total = setTimeout(() => req.destroy(new Error('Website check timed out.')), 10000);
    req.on('close', () => clearTimeout(total));
  });
  if (result.status >= 300 && result.status < 400 && result.location)
    return safeFetch(new URL(result.location, url).href, depth + 1);
  return result;
}
