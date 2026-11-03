import { createHash, timingSafeEqual } from 'node:crypto';

const problem = (status, message) => Object.assign(new Error(message), { status });
export function paynowHash(entries, key) {
  return createHash('sha512')
    .update(
      entries
        .filter(([k]) => k.toLowerCase() !== 'hash')
        .map(([, v]) => v)
        .join('') + key.toLowerCase(),
    )
    .digest('hex')
    .toUpperCase();
}
export function signedMessage(text, key) {
  const entries = [...new URLSearchParams(text)];
  const names = entries.map(([k]) => k.toLowerCase());
  if (new Set(names).size !== names.length) throw problem(400, 'Duplicate payment fields.');
  const hash = entries.find(([k]) => k.toLowerCase() === 'hash')?.[1];
  if (
    !hash ||
    !/^[A-Fa-f0-9]{128}$/.test(hash) ||
    !timingSafeEqual(Buffer.from(hash.toUpperCase()), Buffer.from(paynowHash(entries, key)))
  )
    throw problem(400, 'Invalid payment signature.');
  return Object.fromEntries(entries.map(([k, v]) => [k.toLowerCase(), v]));
}
export function paynowURL(value, kind) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw problem(502, 'Invalid payment provider address.');
  }
  const prefix = kind === 'poll' ? '/interface/checkpayment/' : '/payment/';
  if (
    u.origin !== 'https://www.paynow.co.zw' ||
    u.username ||
    u.password ||
    u.hash ||
    !u.pathname.toLowerCase().startsWith(prefix)
  )
    throw problem(502, 'Invalid payment provider address.');
  return u.href;
}
export class PaynowGateway {
  constructor(config, request = fetch) {
    this.config = config;
    this.request = request;
  }
  async post(url, form) {
    let response;
    try {
      response = await this.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form?.toString() || '',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      // Bound provider responses too, without storing card or instrument fields.
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 64000) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      return signedMessage(Buffer.concat(chunks).toString('utf8'), this.config.key);
    } catch (e) {
      if (e.status) throw e;
      throw problem(
        503,
        'Paynow could not be reached. Check payment status before trying another purchase.',
      );
    }
  }
  async initiate(order, email) {
    const c = this.config;
    const entries = Object.entries({
      id: c.id,
      reference: order.reference,
      amount: (order.amount / 100).toFixed(2),
      additionalinfo: 'Business Workspace Pro - 30 days, no automatic renewal',
      returnurl: c.appURL + '/?view=billing',
      resulturl: c.appURL + '/api/billing/paynow/callback',
      authemail: c.mode === 'test' ? c.testEmail : email,
      status: 'Message',
    });
    const form = new URLSearchParams(entries);
    form.append('hash', paynowHash(entries, c.key));
    const result = await this.post('https://www.paynow.co.zw/interface/initiatetransaction', form);
    if (result.status?.toLowerCase() !== 'ok')
      throw problem(
        502,
        'Paynow did not create the checkout. Contact the app owner before retrying.',
      );
    return {
      browserURL: paynowURL(result.browserurl, 'browser'),
      pollURL: paynowURL(result.pollurl, 'poll'),
    };
  }
  poll(url) {
    return this.post(paynowURL(url, 'poll'));
  }
}
