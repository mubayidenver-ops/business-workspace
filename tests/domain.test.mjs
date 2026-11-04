import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, writeCSV, cleanCSV } from '../shared/csv.mjs';
import { validateRecord } from '../server/validation.mjs';
import { publicIPv4, safeFetch } from '../server/network.mjs';
import { tools } from '../shared/tools.mjs';

test('CSV handles commas, quotes, multiline fields, BOM and CRLF', () => {
  assert.deepEqual(parseCSV('\uFEFFname,notes\r\nAlex,"one, two\nthree ""quoted"""\r\n'), [
    ['name', 'notes'],
    ['Alex', 'one, two\nthree "quoted"'],
  ]);
});
test('CSV validates malformed quoted input', () => {
  assert.throws(() => parseCSV('a,b\n"unfinished'), /closing quote/);
  assert.throws(() => parseCSV('a,b\n"x"oops,y'), /Unexpected text/);
});
test('CSV cleans duplicates and spaces but preserves inconsistent rows with a warning', () => {
  const r = cleanCSV(' name , email\n Alex , a@b.com \nAlex,a@b.com\n,\nBob,b@c.com,extra');
  assert.equal(r.duplicates, 1);
  assert.equal(r.empty, 1);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows[1], ['Alex', 'a@b.com']);
});
test('CSV export defuses formula injection and escapes embedded quotes', () => {
  const result = parseCSV(writeCSV([['=HYPERLINK("x")', '+cmd', '@SUM(A1)', 'normal']]));
  assert.deepEqual(result, [['\'=HYPERLINK("x")', "'+cmd", "'@SUM(A1)", 'normal']]);
});
test('all 30 modules have unique IDs and validate their minimum record', () => {
  assert.equal(tools.length, 30);
  assert.equal(new Set(tools.map((t) => t.id)).size, 30);
  for (const tool of tools) {
    const data = Object.fromEntries(
      tool.fields.map((f) => [
        f.key,
        f.type === 'number'
          ? f.key === 'to'
            ? 20
            : 10
          : f.type === 'checkbox'
            ? false
            : f.type === 'date'
              ? '2030-01-01'
              : f.type === 'datetime-local'
                ? f.key === 'end'
                  ? '2030-01-01T11:00:00.000Z'
                  : '2030-01-01T10:00:00.000Z'
                : f.type === 'url'
                  ? 'https://example.com'
                  : f.type === 'email'
                    ? 'test@example.com'
                    : f.key === 'currency'
                      ? 'USD'
                      : f.key === 'registrationDomain'
                        ? 'example.com'
                        : 'Test',
      ]),
    );
    assert.equal(validateRecord(tool.id, { title: 'Test', status: 'Draft', data }).title, 'Test');
  }
});
test('financial and booking invariants reject invalid values', () => {
  assert.throws(
    () =>
      validateRecord('invoices', {
        title: 'X',
        status: 'Active',
        data: { client: 'X', amount: 10, paid: 20 },
      }),
    /cannot exceed/,
  );
  assert.throws(
    () => validateRecord('projects', { title: 'X', status: 'Active', data: { amount: -3 } }),
    /must be a number/,
  );
  assert.throws(
    () =>
      validateRecord('booking', {
        title: 'X',
        status: 'Active',
        data: { client: 'X', start: '2030-01-01T11:00:00.000Z', end: '2030-01-01T10:00:00.000Z' },
      }),
    /end after/,
  );
  assert.throws(
    () =>
      validateRecord('proposals', {
        title: 'X',
        status: 'Active',
        data: { client: 'X', amount: 10, currency: 'INVALID' },
      }),
    /currency/,
  );
});
test('network policy rejects local, private, metadata, reserved and IPv6 targets', async () => {
  for (const ip of [
    '0.0.0.0',
    '10.1.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
  ])
    assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4('93.184.216.34'), true);
  for (const url of [
    'http://127.0.0.1',
    'http://localhost',
    'http://[::1]',
    'http://10.0.0.1',
    'file:///etc/passwd',
    'https://example.com:8443',
    'http://user:password@example.com',
  ])
    await assert.rejects(() => safeFetch(url));
});
