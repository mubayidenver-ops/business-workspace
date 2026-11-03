import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Billing, billingConfig, entitlement, PERIOD } from '../server/billing.mjs';
import { signedMessage, paynowHash, paynowURL, PaynowGateway } from '../server/paynow.mjs';
import { SQLiteStore } from '../server/storage/sqlite.mjs';
import { DynamoStore } from '../server/storage/dynamodb.mjs';
import { localDynamoFixture } from './dynamo-support.mjs';
const key = '3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977';
const config = { mode: 'live', id: '1201', key, appURL: 'https://example.com' };
function sign(data) {
  const entries = Object.entries(data);
  return new URLSearchParams([...entries, ['hash', paynowHash(entries, key)]]).toString();
}
test('Paynow hashing matches the published official test vector', () => {
  const entries = Object.entries({
    id: '1201',
    reference: 'TEST REF',
    amount: '99.99',
    additionalinfo: 'A test ticket transaction',
    returnurl: 'http://www.google.com/search?q=returnurl',
    resulturl: 'http://www.google.com/search?q=resulturl',
    status: 'Message',
  });
  assert.equal(
    paynowHash(entries, key),
    '2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689',
  );
  const raw = sign({ reference: 'TEST REF', amount: '9.00', status: 'Paid' });
  assert.equal(signedMessage(raw, key).reference, 'TEST REF');
  assert.throws(() => signedMessage(raw.replace('9.00', '1.00'), key), /signature/);
  assert.throws(() => signedMessage(raw + '&status=Paid', key), /Duplicate/);
});
test('provider URLs, live configuration and unsigned responses fail closed', async () => {
  for (const url of [
    'http://www.paynow.co.zw/interface/checkpayment/?guid=x',
    'https://www.paynow.co.zw.evil.com/interface/checkpayment/',
    'https://127.0.0.1/interface/checkpayment/',
    'https://www.paynow.co.zw@evil.com/interface/checkpayment/',
    'https://www.paynow.co.zw/admin',
  ])
    assert.throws(() => paynowURL(url, 'poll'));
  assert.equal(billingConfig({}).mode, 'disabled');
  assert.throws(() => billingConfig({ BILLING_MODE: 'live' }));
  const gateway = new PaynowGateway(config, async () => new Response('status=Paid'));
  await assert.rejects(
    () => gateway.poll('https://www.paynow.co.zw/interface/checkpayment/?guid=x'),
    /signature/,
  );
});
test('hosted checkout signs the exact server price and verifies provider responses', async () => {
  const requests = [];
  const gateway = new PaynowGateway(config, async (url, options) => {
    requests.push({ url, options });
    const outgoing = signedMessage(options.body, key);
    assert.equal(outgoing.amount, '9.00');
    assert.equal(outgoing.authemail, 'customer@example.com');
    assert.equal(outgoing.resulturl, 'https://example.com/api/billing/paynow/callback');
    assert.equal(options.redirect, 'error');
    return new Response(
      sign({
        status: 'Ok',
        browserurl: 'https://www.paynow.co.zw/Payment/ConfirmPayment/123',
        pollurl: 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=x',
      }),
    );
  });
  const result = await gateway.initiate(
    { reference: 'BW123', amount: 900 },
    'customer@example.com',
  );
  assert.equal(requests.length, 1);
  assert.equal(result.pollURL, 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=x');
});

test('entitlements expire, stack renewals, separate test payments and remove refunded grants', () => {
  const now = 1000000;
  const orders = [
    { reference: 'a', mode: 'live', status: 'paid', activatedAt: now },
    { reference: 'b', mode: 'live', status: 'paid', activatedAt: now + 1 },
  ];
  assert.equal(entitlement(orders, 'live', now + 2).activeUntil, now + 2 * PERIOD);
  assert.equal(entitlement(orders, 'test', now).plan, 'free');
  assert.equal(entitlement(orders, 'live', now + 2 * PERIOD).plan, 'free');
  orders[0].status = 'refunded';
  assert.equal(entitlement(orders, 'live', now + 2).activeUntil, now + 1 + PERIOD);
});
for (const backend of ['sqlite', 'dynamodb'])
  test(
    `billing lifecycle on ${backend}`,
    { skip: backend === 'dynamodb' && !process.env.DYNAMODB_TEST_ENDPOINT },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), 'bw-billing-'));
      const fixture = backend === 'dynamodb' ? await localDynamoFixture() : null;
      const store = fixture
        ? new DynamoStore({ table: fixture.table, endpoint: fixture.endpoint })
        : new SQLiteStore(directory);
      t.after(async () => {
        await store.close();
        if (fixture) await fixture.close();
        await rm(directory, { recursive: true, force: true });
      });
      const user = {
        id: randomUUID(),
        email: 'billing@example.com',
        name: 'Billing',
        password: 'salt:hash',
      };
      await store.createUser(user);
      let calls = 0,
        status = 'Paid',
        tamper = false;
      let currentRef;
      const gateway = {
        async initiate(order) {
          calls++;
          currentRef = order.reference;
          return {
            browserURL: 'https://www.paynow.co.zw/payment/confirmpayment/123',
            pollURL: 'https://www.paynow.co.zw/interface/checkpayment/?guid=x',
          };
        },
        async poll() {
          return {
            reference: currentRef,
            amount: tamper ? '1.00' : '9.00',
            status,
            paynowreference: '123',
          };
        },
      };
      const billing = new Billing(store, config, gateway);
      await assert.rejects(
        () => billing.requirePro(user.id),
        (e) => e.status === 402,
      );
      const request = {
        accepted: true,
        requestKey: randomUUID(),
        amount: 1,
        plan: 'pro',
        paid: true,
      };
      const checkout = await billing.checkout(user, request);
      assert.match(checkout.url, /paynow/);
      assert.equal((await billing.checkout(user, request)).url, checkout.url);
      assert.equal(calls, 1);
      let orders = await store.payments(user.id),
        ref = orders[0].reference;
      assert.equal(orders[0].amount, 900);
      await assert.rejects(
        () => billing.reconcile(ref, 'different-user'),
        (e) => e.status === 404,
      );
      tamper = true;
      await assert.rejects(() => billing.reconcile(ref, user.id), /match/);
      tamper = false;
      await Promise.all([billing.reconcile(ref, user.id), billing.reconcile(ref, user.id)]);
      const first = await billing.summary(user.id);
      assert.equal(first.plan, 'pro');
      await billing.requirePro(user.id);
      await billing.callback(
        sign({
          reference: ref,
          amount: '9.00',
          paynowreference: '123',
          status: 'Paid',
          pollurl: orders[0].pollURL,
        }),
      );
      assert.equal((await billing.summary(user.id)).activeUntil, first.activeUntil);
      const publicText = JSON.stringify(first);
      assert.ok(
        !publicText.includes('guid=') &&
          !publicText.includes('browserURL') &&
          !publicText.includes(user.id),
      );
      assert.deepEqual(await store.payments('different-user'), []);
      status = 'Refunded';
      await billing.reconcile(ref, user.id);
      assert.equal((await billing.summary(user.id)).plan, 'free');
      status = 'Paid';
      await billing.reconcile(ref, user.id);
      assert.equal((await billing.summary(user.id)).plan, 'free');
      await assert.rejects(
        () => new Billing(store, { mode: 'disabled' }, gateway).checkout(user, request),
        (e) => e.status === 503,
      );
      assert.equal(calls, 1);
    },
  );
