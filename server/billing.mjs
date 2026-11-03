import { createHash } from 'node:crypto';
import { PaynowGateway, signedMessage, paynowURL } from './paynow.mjs';
const fail = (status, message) => Object.assign(new Error(message), { status });
export const PRO_AMOUNT = 900;
export const PERIOD = 30 * 86400000;
const paid = new Set(['paid', 'awaiting delivery', 'delivered']);
const statuses = new Set([...paid, 'created', 'sent', 'cancelled', 'disputed', 'refunded']);
export function billingConfig(env = process.env) {
  const mode = env.BILLING_MODE || 'disabled';
  if (!['disabled', 'test', 'live'].includes(mode)) throw new Error('Invalid BILLING_MODE.');
  if (mode === 'disabled') return { mode };
  const appURL = env.APP_URL || env.RENDER_EXTERNAL_URL;
  if (
    !appURL ||
    new URL(appURL).protocol !== 'https:' ||
    new URL(appURL).origin !== appURL ||
    !/^\d+$/.test(env.PAYNOW_INTEGRATION_ID || '') ||
    !/^[a-f0-9-]{36}$/i.test(env.PAYNOW_INTEGRATION_KEY || '') ||
    (mode === 'test' && !env.PAYNOW_TEST_EMAIL) ||
    (mode === 'live' &&
      (env.PAYNOW_LIVE_APPROVED !== 'true' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BILLING_SUPPORT_EMAIL || '')))
  )
    throw new Error('Billing needs a verified USD Paynow integration and HTTPS app origin.');
  return {
    mode,
    appURL,
    id: env.PAYNOW_INTEGRATION_ID,
    key: env.PAYNOW_INTEGRATION_KEY.toLowerCase(),
    testEmail: env.PAYNOW_TEST_EMAIL,
    supportEmail: env.BILLING_SUPPORT_EMAIL || null,
  };
}
export function entitlement(orders, mode, now = Date.now()) {
  let until = 0;
  for (const o of orders
    .filter((o) => o.mode === mode && paid.has(o.status) && o.activatedAt)
    .sort((a, b) => a.activatedAt - b.activatedAt || a.reference.localeCompare(b.reference)))
    until = Math.max(until, o.activatedAt) + PERIOD;
  return { plan: until > now ? 'pro' : 'free', activeUntil: until || null };
}
export function publicOrder(o) {
  return {
    reference: o.reference,
    amount: o.amount,
    currency: 'USD',
    status: o.status,
    mode: o.mode,
    created: o.created,
    activatedAt: o.activatedAt || null,
    canResume: !!o.browserURL && ['created', 'sent'].includes(o.status),
    canCheck: !!o.pollURL,
  };
}
export class Billing {
  constructor(store, config = billingConfig(), gateway = new PaynowGateway(config)) {
    this.store = store;
    this.config = config;
    this.gateway = gateway;
  }
  async summary(userId) {
    const orders = await this.store.payments(userId);
    const mode = this.config.mode;
    return {
      mode,
      ...entitlement(orders, mode),
      amount: PRO_AMOUNT,
      currency: 'USD',
      days: 30,
      autoRenew: false,
      supportEmail: this.config.supportEmail || null,
      orders: orders.sort((a, b) => b.created.localeCompare(a.created)).map(publicOrder),
    };
  }
  async requirePro(userId) {
    if (this.config.mode !== 'live') return;
    if ((await this.summary(userId)).plan !== 'pro')
      throw fail(
        402,
        'Pro access is required. Open Billing to purchase 30 days. Your saved data remains available.',
      );
  }
  async checkout(user, input) {
    if (this.config.mode === 'disabled')
      throw fail(503, 'Payments are not active yet. No charge was made.');
    if (input.accepted !== true || !/^[a-f0-9-]{36}$/i.test(input.requestKey || ''))
      throw fail(400, 'Confirm the price and 30-day access before continuing.');
    const reference =
      'BW' +
      createHash('sha256')
        .update(user.id + ':' + input.requestKey + ':' + this.config.mode)
        .digest('hex')
        .slice(0, 30);
    const order = {
      reference,
      userId: user.id,
      amount: PRO_AMOUNT,
      mode: this.config.mode,
      integrationId: this.config.id,
      status: 'initializing',
      version: 1,
      created: new Date().toISOString(),
    };
    const saved = await this.store.createPayment(order);
    if (!saved.created) {
      if (saved.order.browserURL && ['created', 'sent'].includes(saved.order.status))
        return { url: paynowURL(saved.order.browserURL, 'browser') };
      throw fail(
        409,
        'This purchase already exists. Check its status in Billing before starting another.',
      );
    }
    // Never re-initiate a timed-out order automatically: the provider may have received it.
    const result = await this.gateway.initiate(order, user.email);
    await this.store.updatePayment(reference, 1, { ...result, status: 'created' });
    return { url: result.browserURL };
  }
  validateResult(order, result) {
    if (
      result.reference !== order.reference ||
      !/^\d+(\.\d{1,2})?$/.test(result.amount || '') ||
      Number(result.amount) * 100 !== order.amount ||
      !result.paynowreference ||
      result.paynowreference.length > 100 ||
      !statuses.has(result.status?.toLowerCase()) ||
      (order.paynowReference && order.paynowReference !== result.paynowreference)
    )
      throw fail(400, 'Payment details do not match this purchase.');
  }
  async reconcile(reference, userId, incoming) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.store.getPayment(reference);
      if (!order || (userId && order.userId !== userId)) throw fail(404, 'Purchase not found.');
      if (order.mode !== this.config.mode || order.integrationId !== this.config.id)
        throw fail(409, 'This purchase belongs to a different payment configuration.');
      if (incoming) this.validateResult(order, incoming);
      const pollURL = order.pollURL || (incoming && paynowURL(incoming.pollurl, 'poll'));
      if (!pollURL)
        throw fail(
          409,
          'Checkout confirmation is not available yet. Contact the app owner with the purchase reference.',
        );
      const result = await this.gateway.poll(pollURL);
      this.validateResult(order, result);
      const status = result.status.toLowerCase();
      // A refund is final. Never revive it from a delayed message.
      if (order.status === 'refunded' && status !== 'refunded') return publicOrder(order);
      const patch = {
        status,
        pollURL,
        paynowReference: result.paynowreference,
        checkedAt: Date.now(),
        ...(paid.has(status) && !order.activatedAt ? { activatedAt: Date.now() } : {}),
      };
      try {
        return publicOrder(await this.store.updatePayment(reference, order.version, patch));
      } catch (e) {
        if (e.status !== 409 || attempt === 4) throw e;
      }
    }
  }
  async callback(raw) {
    if (this.config.mode === 'disabled') throw fail(503, 'Billing is disabled.');
    const result = signedMessage(raw, this.config.key);
    await this.reconcile(result.reference, null, result);
  }
}
