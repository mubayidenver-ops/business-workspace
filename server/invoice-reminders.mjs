import { createHash } from 'node:crypto';

export function reminderCandidate(record) {
  if (record.module !== 'invoices' || record.archived || record.status !== 'Active') return null;
  const data = JSON.parse(record.data);
  if (
    !data.emailReminder ||
    data.pauseReminders ||
    !data.email ||
    !data.due ||
    !(Number(data.amount) > Number(data.paid || 0))
  )
    return null;
  return data;
}

export function reminderConfig(env = process.env) {
  const allowed = (env.INVOICE_REMINDER_WORKSPACES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return env.RESEND_API_KEY && env.REMINDER_FROM_EMAIL && allowed.length
    ? { key: env.RESEND_API_KEY, from: env.REMINDER_FROM_EMAIL, allowed: new Set(allowed) }
    : null;
}

export async function sendInvoiceReminders(store, config, send = fetch, now = Date.now()) {
  if (!config) return 0;
  let attempts = 0;
  let failures = 0;
  for (const pointer of await store.invoiceReminders()) {
    if (attempts >= 10) break;
    if (!config.allowed.has(pointer.user_id)) continue;
    const record = await store.getRecord(pointer.user_id, pointer.id);
    const data = record && reminderCandidate(record);
    if (!data) continue;
    const due = Date.parse(data.due + 'T00:00:00Z');
    const lead = Number(data.reminderDays || 0) * 86400000;
    // Avoid surprise sends for invoices whose due dates are long past.
    if (now < due - lead || now >= due + 7 * 86400000) continue;
    const key = createHash('sha256')
      .update(JSON.stringify([record.id, data.due]))
      .digest('hex');
    if (!(await store.claimInvoiceReminder(record.user_id, key, now))) continue;
    const current = await store.getRecord(record.user_id, record.id);
    if (!current || current.version !== record.version || !reminderCandidate(current)) {
      await store.finishInvoiceReminder(record.user_id, key, 'superseded');
      continue;
    }
    attempts++;
    const outstanding = Number(data.amount) - Number(data.paid || 0);
    const amount = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: data.currency || 'USD',
    }).format(outstanding);
    const payload = JSON.stringify({
      from: config.from,
      to: [data.email],
      subject: 'Invoice payment reminder',
      text:
        'Hello ' +
        data.client +
        ',\n\nThis is a reminder that invoice ' +
        (data.reference || record.title) +
        ' has an outstanding balance of ' +
        amount +
        ' and is due on ' +
        data.due +
        '. Please contact the invoice issuer if you have questions.\n\nBusiness Workspace',
    });
    let accepted = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await send('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + config.key,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'invoice-reminder/' + key,
          },
          body: payload,
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        await response.body?.cancel();
        accepted = response.ok;
        if (accepted || (response.status < 500 && response.status !== 429)) break;
      } catch {
        // A second attempt uses the same provider idempotency key.
      }
    }
    await store.finishInvoiceReminder(record.user_id, key, accepted ? 'accepted' : 'uncertain');
    if (!accepted) failures++;
  }
  return failures;
}
