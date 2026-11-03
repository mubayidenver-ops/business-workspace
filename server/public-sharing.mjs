import { storageError } from './storage/rules.mjs';
import { documentFromData } from '../shared/pricing.mjs';
export const shareableModules = [
  'proposals',
  'approvals',
  'invoices',
  'onboarding',
  'portfolio',
  'help',
  'catalogues',
  'testimonials',
  'uptime',
];
export function assertShareable(record) {
  if (record.archived || record.status === 'Cancelled' || !shareableModules.includes(record.module))
    throw storageError(400, 'This record cannot be shared.');
  if (record.module === 'testimonials' && !JSON.parse(record.data).consent)
    throw storageError(400, 'Record permission to publish before sharing a testimonial.');
}
export function publicProjection(record, share, latest = null) {
  const d = JSON.parse(record.data);
  const result = {
    title: record.title,
    module: record.module,
    brand: share.brand,
    version: record.version,
    expires: share.expires,
  };
  const fields = {
    proposals: ['client', 'currency', 'amount', 'notes'],
    invoices: ['client', 'currency', 'amount', 'paid', 'due', 'notes'],
    approvals: ['client', 'url', 'notes'],
    onboarding: ['publicNotes'],
    portfolio: ['client', 'url', 'notes'],
    help: ['category', 'notes'],
    catalogues: ['currency', 'amount', 'url', 'notes'],
    testimonials: ['client', 'notes'],
    uptime: ['url'],
  }[record.module];
  result.data = Object.fromEntries(fields.map((key) => [key, d[key] ?? '']));
  if (['proposals', 'invoices'].includes(record.module)) result.document = documentFromData(d);
  if (record.module === 'uptime')
    result.check = latest
      ? {
          created: latest.created,
          ok: latest.result.ok,
          status: latest.result.status,
          ms: latest.result.ms,
        }
      : null;
  return result;
}
export function clientResponse(record, input) {
  const name = String(input.name || '').trim(),
    message = String(input.message || '').trim(),
    email = String(input.email || '').trim();
  if (!name || name.length > 100 || message.length > 5000)
    throw storageError(
      400,
      'Enter your name (up to 100 characters) and a message under 5,000 characters.',
    );
  if (!['proposals', 'approvals', 'onboarding'].includes(record.module))
    throw storageError(400, 'This page does not accept responses.');
  const action = record.module === 'onboarding' ? 'brief' : input.action;
  if (
    !['brief', 'approve', 'changes'].includes(action) ||
    (record.module !== 'onboarding' && action === 'brief')
  )
    throw storageError(400, 'Choose a valid response.');
  if (
    action === 'brief' &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !message)
  )
    throw storageError(400, 'Enter a valid email and the details of your brief.');
  if (action === 'changes' && !message) throw storageError(400, 'Describe the changes you need.');
  return {
    name,
    message,
    ...(action === 'brief' ? { email } : {}),
    action,
    created: new Date().toISOString(),
  };
}
