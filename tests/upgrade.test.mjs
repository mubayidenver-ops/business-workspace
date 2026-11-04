import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlLinks, comparePage } from '../server/website-checks.mjs';
import { safeFetch } from '../server/network.mjs';
import { validateAttachment } from '../server/attachments.mjs';
import { clientResponse } from '../server/public-sharing.mjs';
import { assertBooking } from '../server/storage/rules.mjs';

test('bounded crawler deduplicates redirected targets and retains referring pages', async () => {
  const base = 'https://example.com';
  const page = (path, body, status = 200) => ({ url: base + path, status, body });
  const fixture = new Map([
    [base + '/a', page('/a', '<a href="/dead">Broken</a><a href="/dead#anchor">Again</a>')],
    [base + '/go', page('/dead', '', 404)],
    [base + '/dead', page('/dead', '', 404)],
  ]);
  const calls = [];
  const result = await crawlLinks(
    page(
      '/',
      '<a href="/a">A</a><a href="/go">Go</a><a href="https://other.example/">Off site</a>',
    ),
    async (url, depth, origin) => {
      assert.equal(origin, base);
      calls.push(url);
      return fixture.get(url);
    },
  );
  assert.deepEqual(calls.sort(), [...fixture.keys()].sort());
  assert.deepEqual(
    result.filter((row) => row.status === 404),
    [
      {
        url: base + '/dead',
        status: 404,
        sources: [base + '/', base + '/a'],
      },
    ],
  );
  await assert.rejects(safeFetch('https://other.example/', 0, base), /Cross-site redirect/);
});

test('page changes ignore noisy lines and show a before/after preview', () => {
  const options = {
    url: 'https://example.com',
    regionStart: 'Watch',
    regionEnd: 'End',
    ignoreText: 'Clock:',
  };
  const page = (price, clock) => ({
    body: '<p>Watch</p><p>Price ' + price + '</p><p>Clock: ' + clock + '</p><p>End</p>',
  });
  const before = comparePage(page(20, 10), options);
  assert.equal(comparePage(page(20, 11), options, before).changed, false);
  const after = comparePage(page(25, 12), options, before);
  assert.equal(after.changed, true);
  assert.deepEqual(after.diff, { before: 'Price 20', after: 'Price 25' });
  assert.equal(comparePage(page(25, 13), options, after).changed, false);
});

test('intake validates checklist answers and rejects mismatched attachment formats', () => {
  const attachment = {
    name: 'brief.pdf',
    mime: 'application/pdf',
    content: Buffer.from('%PDF-1.4').toString('base64'),
  };
  assert.throws(() => validateAttachment({ ...attachment, mime: 'image/png' }), /valid PDF/);
  const record = {
    module: 'onboarding',
    version: 4,
    data: JSON.stringify({ intakeChecklist: 'Goal\nBudget' }),
  };
  const input = { name: 'Client', email: 'c@example.com', message: 'Brief', attachment };
  assert.throws(
    () => clientResponse(record, { ...input, answers: ['Goal'] }),
    /required intake question/,
  );
  const saved = clientResponse(record, { ...input, answers: ['Launch', 'USD 100'] });
  assert.equal(saved.reviewedVersion, 4);
  assert.deepEqual(saved.intake[1], { question: 'Budget', answer: 'USD 100' });
  assert.deepEqual(JSON.parse(saved.attachment), attachment);
});

test('booking buffers protect the slot with legacy unbuffered records', () => {
  const booking = (id, start, end, bufferMinutes) => ({
    id,
    module: 'booking',
    status: 'Active',
    data: JSON.stringify({
      start: '2026-11-04T' + start + ':00Z',
      end: '2026-11-04T' + end + ':00Z',
      bufferMinutes,
    }),
  });
  const first = booking('a', '08:00', '09:00', 15);
  assert.throws(() => assertBooking([first], booking('b', '09:10', '10:00')), /overlaps/);
  assert.doesNotThrow(() => assertBooking([first], booking('b', '09:15', '10:00')));
});
