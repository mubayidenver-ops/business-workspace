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

test('invoice reminders require opt-in, skip paid or paused invoices, and claim one delivery', async () => {
  const { sendInvoiceReminders } = await import('../server/invoice-reminders.mjs');
  const now = Date.parse('2026-11-04T08:00:00Z');
  const data = {
    client: 'Client',
    amount: '100',
    paid: '20',
    currency: 'USD',
    due: '2026-11-04',
    email: 'client@example.com',
    emailReminder: true,
  };
  const rows = [
    { id: 'send', overrides: {} },
    { id: 'paid', overrides: { paid: '100' } },
    { id: 'paused', overrides: { pauseReminders: true } },
    { id: 'unapproved', overrides: { emailReminder: false } },
  ].map(({ id, overrides }) => ({
    id,
    user_id: 'owner',
    version: 1,
    module: 'invoices',
    status: 'Active',
    title: 'Invoice',
    data: JSON.stringify({ ...data, ...overrides }),
  }));
  const claimed = new Set();
  const store = {
    invoiceReminders: async () => rows,
    getRecord: async (_owner, id) => rows.find((row) => row.id === id),
    claimInvoiceReminder: async (_owner, key) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    finishInvoiceReminder: async () => {},
  };
  const messages = [];
  const send = async (url, request) => {
    assert.equal(url, 'https://api.resend.com/emails');
    messages.push(request);
    return new Response(null, { status: messages.length === 1 ? 503 : 200 });
  };
  const config = { key: 'test-key', from: 'invoices@example.com', allowed: new Set(['owner']) };
  await Promise.all([
    sendInvoiceReminders(store, config, send, now),
    sendInvoiceReminders(store, config, send, now),
  ]);
  assert.equal(claimed.size, 1);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].headers['Idempotency-Key'], messages[1].headers['Idempotency-Key']);
  assert.equal(messages[0].body, messages[1].body);
  assert.match(JSON.parse(messages[0].body).text, /80\.00/);
});

test('AI drafts use only approved notes from the selected revision', async () => {
  const { draftRecord } = await import('../server/ai-drafts.mjs');
  const record = {
    module: 'meetings',
    title: 'Private title',
    version: 3,
    data: JSON.stringify({
      notes: 'Agree the launch date.',
      email: 'private@example.com',
      attachment: 'secret',
    }),
  };
  const config = { key: 'fake-key', model: 'configured-model' };
  let calls = 0;
  const send = async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const input = JSON.parse(request.body);
    assert.equal(input.input, 'Agree the launch date.');
    assert.equal(input.store, false);
    assert.equal(input.model, 'configured-model');
    assert.ok(!request.body.includes('private@example.com'));
    return Response.json({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Confirm the date.' }] }],
    });
  };
  await assert.rejects(
    draftRecord(record, { confirmed: true, version: 2 }, config, send),
    /current record/,
  );
  await assert.rejects(
    draftRecord(record, { confirmed: true, version: 3 }, null, send),
    /unavailable/,
  );
  const result = await draftRecord(record, { confirmed: true, version: 3 }, config, send);
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    draft: 'Confirm the date.',
    source: { title: 'Private title', version: 3 },
  });
});

test('RDAP uses the trusted bootstrap and returns only a matching domain expiry', async () => {
  const { registrationExpiry, registrationDomain } = await import('../server/rdap.mjs');
  assert.equal(registrationDomain('https://example.com'), '');
  assert.equal(registrationDomain('example.com/path'), '');
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    return {
      status: 200,
      body: JSON.stringify(
        url.includes('iana.org')
          ? { services: [[['com'], ['https://registry.example/rdap/']]] }
          : {
              objectClassName: 'domain',
              ldhName: 'example.com',
              events: [{ eventAction: 'expiration', eventDate: '2030-02-01T00:00:00Z' }],
            },
      ),
    };
  };
  assert.equal(await registrationExpiry('EXAMPLE.COM.', fetchPage), '2030-02-01T00:00:00.000Z');
  assert.equal(await registrationExpiry('other.com', fetchPage), null);
  assert.deepEqual(calls, [
    'https://data.iana.org/rdap/dns.json',
    'https://registry.example/rdap/domain/example.com',
    'https://registry.example/rdap/domain/other.com',
  ]);
});

test('authenticator matches the RFC 6238 SHA-1 vector and rejects replay', async () => {
  const { totp, matchStep, base32 } = await import('../server/mfa.mjs');
  const bytes = Buffer.from('12345678901234567890');
  const secret = bytes.toString('hex');
  assert.equal(base32(bytes), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp(secret, 1), '287082');
  assert.equal(matchStep(secret, '287082', -1, 59000), 1);
  assert.equal(matchStep(secret, '287082', 1, 59000), null);
});

test('a failed scheduled check does not suppress later monitors', async () => {
  const { runMonitorCycle } = await import('../server/uptime.mjs');
  const monitors = ['failed', 'later', 'recent'].map((id) => ({
    id,
    user_id: 'owner',
    module: 'uptime',
    data: '{}',
  }));
  const checked = [];
  const count = await runMonitorCycle(
    {
      monitors: async () => monitors,
      latestCheck: async (_owner, id) =>
        id === 'recent' ? { created: new Date().toISOString() } : null,
    },
    async (record) => {
      checked.push(record.id);
      if (record.id === 'failed') throw new Error('Storage unavailable');
    },
  );
  assert.equal(count, 1);
  assert.deepEqual(checked, ['failed', 'later']);
});
