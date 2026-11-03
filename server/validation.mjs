import { byId, statuses } from '../shared/tools.mjs';
import { calculateDocument } from '../shared/pricing.mjs';
export function validateRecord(module, input) {
  const tool = Object.hasOwn(byId, module) ? byId[module] : null;
  if (!tool) throw new Error('Unknown tool.');
  let pricing;
  if (['proposals', 'invoices'].includes(module) && input.data?.lineItems) {
    let items;
    try {
      items = JSON.parse(input.data.lineItems);
    } catch {
      throw new Error('Line items must be valid JSON.');
    }
    pricing = calculateDocument(
      items,
      String(input.data.currency || 'USD').toUpperCase(),
      input.data.discountPercent,
      input.data.taxPercent,
    );
    input = {
      ...input,
      data: { ...input.data, amount: String(pricing.total), currency: pricing.currency },
    };
  }
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 180)
    throw new Error('Enter a title of 1–180 characters.');
  if (!statuses.includes(input.status)) throw new Error('Choose a valid status.');
  const data = {};
  if (pricing) {
    data.lineItems = JSON.stringify(
      pricing.lines.map(({ description, quantity, rate }) => ({ description, quantity, rate })),
    );
    data.discountPercent = String(Number(input.data.discountPercent || 0));
    data.taxPercent = String(Number(input.data.taxPercent || 0));
  }
  for (const field of tool.fields) {
    let value = input.data?.[field.key] ?? '';
    if (field.type === 'checkbox') {
      data[field.key] = value === true;
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new Error(`${field.label} must be text.`);
    value = String(value).trim();
    if (field.required && !value) throw new Error(`${field.label} is required.`);
    if (value.length > 50000) throw new Error(`${field.label} is too long.`);
    if (
      value &&
      field.type === 'number' &&
      (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12)
    )
      throw new Error(`${field.label} must be a number from 0 to 1 trillion.`);
    if (value && field.type === 'url') {
      let u;
      try {
        u = new URL(value);
      } catch {
        throw new Error(`${field.label} needs a full URL, starting with https://.`);
      }
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
        throw new Error('Use an HTTP or HTTPS URL without credentials.');
    }
    if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      throw new Error('Enter a valid email address.');
    if (
      value &&
      field.type === 'date' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
    )
      throw new Error('Enter a valid date.');
    if (
      value &&
      field.type === 'datetime-local' &&
      (!Number.isFinite(Date.parse(value)) || !/Z$/.test(value))
    )
      throw new Error('Choose a valid date and time.');
    data[field.key] = value;
  }
  if (module === 'booking' && Date.parse(data.end) <= Date.parse(data.start))
    throw new Error('The appointment must end after it starts.');
  if (module === 'clips' && Number(data.to) <= Number(data.from))
    throw new Error('The clip must end after it starts.');
  if (module === 'invoices' && Number(data.paid) > Number(data.amount))
    throw new Error('Amount received cannot exceed the invoice amount.');
  if (data.currency) {
    data.currency = data.currency.toUpperCase();
    try {
      new Intl.NumberFormat('en', { style: 'currency', currency: data.currency });
    } catch {
      throw new Error('Use a three-letter currency code, such as USD.');
    }
    if (!/^[A-Z]{3}$/.test(data.currency)) throw new Error('Use a three-letter currency code.');
  }
  return { title: input.title.trim(), status: input.status, data };
}
