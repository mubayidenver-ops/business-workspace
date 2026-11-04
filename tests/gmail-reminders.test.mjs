import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderConfig, sendInvoiceReminders } from '../server/invoice-reminders.mjs';

test('Gmail reminder uses a refresh token and only sends to the configured test mailbox', async () => {
  const config = reminderConfig({
    INVOICE_REMINDER_PROVIDER: 'gmail',
    INVOICE_REMINDER_WORKSPACES: 'owner',
    GMAIL_CLIENT_ID: 'client',
    GMAIL_CLIENT_SECRET: 'secret',
    GMAIL_REFRESH_TOKEN: 'refresh',
    REMINDER_FROM_EMAIL: 'sender@gmail.com',
  });
  const sent = [];
  const store = {
    invoiceReminders: async () => ['customer', 'self'].map((id) => ({ id, user_id: 'owner' })),
    getRecord: async (user_id, id) => ({
      user_id, id, module: 'invoices', status: 'Active', version: 1,
      data: JSON.stringify({
        emailReminder: true, email: id === 'self' ? config.from : 'customer@example.com',
        due: '2026-11-04', amount: 12, client: 'Test', reference: 'INV-1',
      }),
    }),
    claimInvoiceReminder: async () => true,
    finishInvoiceReminder: async (_owner, _key, status) => assert.equal(status, 'accepted'),
  };
  const failures = await sendInvoiceReminders(store, config, async (url, request) => {
    sent.push(url);
    if (sent.length === 1) {
      assert.equal(request.body.get('refresh_token'), 'refresh');
      return Response.json({ access_token: 'access' });
    }
    assert.equal(request.headers.Authorization, 'Bearer access');
    const raw = Buffer.from(JSON.parse(request.body).raw, 'base64url').toString();
    assert.match(raw, /To: sender@gmail\.com/);
    return Response.json({ id: 'message' });
  }, Date.parse('2026-11-04'));
  assert.equal(failures, 0);
  assert.deepEqual(sent, [
    'https://oauth2.googleapis.com/token',
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
  ]);
});
