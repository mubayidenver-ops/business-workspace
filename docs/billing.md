# Paynow billing

## Delivered and activation state

Billing now has an authenticated Plan & billing screen, Paynow hosted checkout, a private purchase ledger, resumable checkout, signed server callbacks plus authenticated polling, account-scoped history, and expiring Pro access. The default is `BILLING_MODE=disabled`: no provider requests or charges are possible. This is application integration, not evidence of a successful live payment.

Pro is US$9 for **30 days**, purchased each time by the customer. Renewing early adds 30 days to unexpired access. There are no automatic renewals, stored cards or off-session debits. Paynow tokenised recurring payments require separate merchant permission and are not implemented. No scheduled billing worker or always-on server is required for these prepaid purchases.

When live billing is enabled, new client-sharing links and proposal-to-invoice conversions require Pro on the server. Free record management, existing records, file utilities, checks, exports and owner document editing remain available. Existing links keep their expiry and remain revocable. The record capacity is unchanged. Disabled/test billing preserves the existing free preview of all workflows. Test payment grants never become live entitlements.

## Merchant setup for the owner

1. Register at [Paynow](https://www.paynow.co.zw/customer/register), choose Merchant, verify your email and set up the settlement account on Paynow. A Mastercard alone is not a merchant account. International card acceptance depends on Paynow approval and your business details.
2. In Paynow, open Other Ways To Get Paid → Create/Manage Shopping Carts → Create Advanced Integration. Create a **USD** integration. Configure it to **absorb transaction fees**, because this app verifies the exact US$9 purchase amount. Request the integration key via Paynow's email-key option. Never send it in chat, commit it, or put it in browser/frontend settings.
3. On the [existing Render service](https://dashboard.render.com/web/srv-dbkrabh5efls73fenk80), open Environment. Add the following server-side values:
   - `BILLING_MODE=test`
   - `PAYNOW_INTEGRATION_ID`: the integration ID
   - `PAYNOW_INTEGRATION_KEY`: the secret integration key
   - `PAYNOW_TEST_EMAIL`: the merchant email registered with the test integration
   - `BILLING_SUPPORT_EMAIL`: the customer support email you control
   - `APP_URL=https://business-workspace-lordyvites.onrender.com`

4. Redeploy. Sign in, open Workspace settings → View plan & billing, and complete a Paynow **test** checkout. Verify confirmation, repeat callbacks, cancellation, return to Billing and expiry/revocation in a test environment. Application tests simulate Paynow; they do not replace this merchant-provider test.
5. Review the US$9 price, the advertised paid features, support arrangements, Paynow's transaction/settlement fees, and your customer refund terms before activation. Complete Paynow's live approval. Follow Paynow's key-rotation instructions when moving from test to live. Configure `PAYNOW_LIVE_APPROVED=true` and `BILLING_MODE=live` only after live approval and successful testing. A support email and valid HTTPS origin are required. Verify a controlled real purchase and settlement before advertising paid access.

Callback: `https://business-workspace-lordyvites.onrender.com/api/billing/paynow/callback`.
Customer return: `https://business-workspace-lordyvites.onrender.com/?view=billing`.

Changing integration ID while there are unfinished purchases prevents their reconciliation. Resolve outstanding purchases first, and coordinate any key rotation with Paynow. Keep ledger backups. The app never logs integration keys, provider poll URLs, card details or callback bodies.

## Correctness and security

Amounts, access duration, owner identity and entitlement are server controlled. The client cannot submit a price or declare payment success. Purchase references are deterministically scoped to the authenticated user and request key; retries never initiate the same purchase twice. A timed-out initialization remains visible and is never automatically retried as a new debit. A later authentic callback can recover its poll URL. Unresolved initializing orders require merchant investigation; do not blindly pay again.

Every provider response and callback must have a matching SHA512 hash, using ordered decoded values and the integration key. Duplicate fields are rejected. The implementation includes Paynow's published hash test vector. Callback data is checked against the saved purchase and then independently polled from Paynow before granting access. Only HTTPS Paynow payment/poll paths are used; redirects are rejected and bodies/timeouts are bounded. Poll URLs are never accepted from authenticated user requests.

Only `Paid`, `Awaiting Delivery` and `Delivered` grant access. These statuses have different settlement/escrow meanings at Paynow; receiving an access grant is not proof that bank settlement has completed. Duplicate callbacks cannot extend access. Cancelled, disputed and refunded payments do not grant access; a refund is final in the ledger. Refunds are initiated by the merchant through Paynow, not this app. A dispute resolved as paid restores its original grant without restarting its 30-day clock. Removing a refunded/disputed grant recomputes the remaining purchased periods. Callback conflicts are retried against current state. Failed provider validation or unavailable polling leaves access unchanged and returns an error for retry.

SQLite adds an isolated payments table. DynamoDB uses `PAYMENT#reference/ORDER` plus a workspace purchase projection, updated atomically with conditional versions. No new AWS tables, indexes or IAM actions are needed. Order entries have no TTL. Access is calculated from ledger grants on each Pro action, so it expires even if the server sleeps. No public payment or provider URL is included in ordinary workspace backups/state. The private billing endpoint returns only allowlisted receipt-like history, not fiscal tax invoices.

Free Render may delay customer return/callback requests while waking. Paynow retries failed callbacks a limited number of times; the signed status-check action allows reconciliation from Billing afterward. Production payments still require reliable hosting and provider testing. International availability is subject to the provider and issuing bank, not guaranteed in every country. Taxes, fiscal invoicing, automated refunds, chargeback case handling and automated renewals are outside this release.

## Official references

- [Merchant payment methods and settlement](https://www.paynow.co.zw/Home/MerchantTutorial)
- [Integration key setup](https://developers.paynow.co.zw/docs/paynow/integration_generation/)
- [Transaction initiation and tokenisation approval](https://developers.paynow.co.zw/docs/paynow/initiate_transaction/)
- [Hash algorithm and test vector](https://developers.paynow.co.zw/docs/paynow/generating_hash/)
- [Callback statuses](https://developers.paynow.co.zw/docs/paynow/status_update/)
- [Authenticated polling](https://developers.paynow.co.zw/docs/paynow/polling_status/)
