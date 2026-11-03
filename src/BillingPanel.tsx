import { useEffect, useRef, useState } from 'react';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { Modal } from './ui';
import { api, date, money } from './lib';
type Order = {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  mode: string;
  created: string;
  canResume: boolean;
  canCheck: boolean;
};
type Summary = {
  supportEmail: string | null;
  mode: string;
  plan: string;
  activeUntil: number | null;
  amount: number;
  currency: string;
  days: number;
  orders: Order[];
};
export function BillingPanel({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  async function load() {
    setSummary(await api<Summary>('/billing'));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function redirect(url: string) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://www.paynow.co.zw') throw new Error('Invalid checkout address.');
    location.assign(url);
  }
  return (
    <Modal
      title="Plan & billing"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="modal-body">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!summary ? (
          <p role="status">{error ? 'Billing could not be loaded.' : 'Loading your plan…'}</p>
        ) : (
          <>
            <div className="integration-note">
              <ShieldCheck size={22} />
              <span>
                {summary.mode === 'disabled'
                  ? 'Payments are not active. Your workspace remains in the free preview, and no charge can be made.'
                  : summary.mode === 'test'
                    ? 'TEST MODE — simulated purchases only. Test access never becomes a live paid entitlement.'
                    : 'Secure hosted checkout with Paynow. Card details stay with the payment provider.'}
              </span>
            </div>
            <h3>
              {summary.mode === 'disabled'
                ? 'Free preview'
                : summary.plan === 'pro'
                  ? summary.mode === 'test'
                    ? 'Test Pro access'
                    : 'Pro access'
                  : 'Free workspace'}
            </h3>
            {summary.activeUntil && summary.plan === 'pro' && (
              <p>
                Access through {date(new Date(summary.activeUntil).toISOString())}. No automatic
                renewal.
              </p>
            )}
            <div className="release-grid">
              <section>
                <h3>Free</h3>
                <p>
                  Saved module workspaces, file utilities, website checks, manual invoices and
                  exports.
                </p>
                <p>Existing saved records stay accessible when Pro expires.</p>
              </section>
              <section>
                <h3>
                  Pro · {money(summary.amount / 100, summary.currency)} / {summary.days} days
                </h3>
                <p>
                  Create private client links for approvals, briefs and selected documents, and
                  convert proposals into invoice drafts.
                </p>
                <p>
                  One payment buys 30 days. Renewing early adds time. No card storage or automatic
                  debit. Provider fees, if applicable, are shown by Paynow before payment.
                </p>
              </section>
            </div>
            <p className="muted">
              During the free preview, Pro workflows remain available. Once live billing starts, Pro
              is required to create new shared links and convert proposals. Existing shared links
              retain their stated expiry.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={accepted}
                disabled={busy || summary.mode === 'disabled'}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I understand this is {money(summary.amount / 100, summary.currency)} for 30 days, with
              no automatic renewal. I have reviewed the features and checkout total.
            </label>
            <button
              className="primary"
              disabled={busy || !accepted || summary.mode === 'disabled'}
              onClick={() =>
                action(async () => {
                  const result = await api<{ url: string }>('/billing/checkout', 'POST', {
                    accepted,
                    requestKey: requestKey.current,
                  });
                  redirect(result.url);
                })
              }
            >
              <CreditCard size={17} />
              {busy
                ? 'Please wait…'
                : summary.mode === 'disabled'
                  ? 'Payments not activated'
                  : summary.mode === 'test'
                    ? 'Open test checkout'
                    : 'Continue to Paynow'}
            </button>
            <p className="muted">
              Payment questions or refund requests: contact the app owner using your purchase
              reference. Refunds are processed by the merchant through Paynow; this screen does not
              issue refunds. If checkout is interrupted, check or resume the existing purchase
              before starting another.
            </p>
            {summary.supportEmail && (
              <p>
                Payment support:{' '}
                <a href={'mailto:' + summary.supportEmail}>{summary.supportEmail}</a>. Include your
                purchase reference; never send card details.
              </p>
            )}
            <h3>Purchase history</h3>
            {!summary.orders.length ? (
              <p>No purchases yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption>Purchases for this workspace</caption>
                  <thead>
                    <tr>
                      <th>Reference / date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.orders.map((o) => (
                      <tr key={o.reference}>
                        <td className="wrap-anywhere">
                          {o.reference}
                          <br />
                          {date(o.created)}
                          {o.mode === 'test' && ' · TEST'}
                        </td>
                        <td>{money(o.amount / 100, o.currency)}</td>
                        <td>{o.status}</td>
                        <td>
                          <div className="actions">
                            {o.canResume && (
                              <button
                                disabled={busy || o.mode !== summary.mode}
                                onClick={() =>
                                  action(async () =>
                                    redirect(
                                      (
                                        await api<{ url: string }>(
                                          `/billing/${o.reference}/resume`,
                                          'POST',
                                          {},
                                        )
                                      ).url,
                                    ),
                                  )
                                }
                              >
                                Resume
                              </button>
                            )}
                            {o.canCheck && (
                              <button
                                disabled={busy || o.mode !== summary.mode}
                                onClick={() =>
                                  action(async () => {
                                    await api(`/billing/${o.reference}/check`, 'POST', {});
                                    await load();
                                  })
                                }
                              >
                                Check status
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button disabled={busy} onClick={() => action(load)}>
              Refresh billing
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
