# Worker and integration readiness

## Run the worker

The web app runs scheduled work by default. To move it to a separate process, run one `npm run worker` process on an always-on host with the same DynamoDB configuration. Set `JOBS_MODE=external` on the web service when the worker is ready. Keep one scheduler active. The worker uses the same network protections, check records, invoice reminder claims and storage adapters as the web app.

Monitor cycles run each minute and invoice reminder cycles run every 15 minutes when configured. A running cycle cannot overlap itself in the same process. Shutdown waits for active cycles. DynamoDB retains run records for seven days when table TTL is enabled. SQLite keeps the latest 20 runs per job. Workspace settings → Connections and scheduled work shows the last completion, errors or an overdue run. The panel is a status view without external missed-run notifications.

Render background workers use paid compute. The free web deployment can continue running the embedded scheduler when awake. [Render background worker plans](https://render.com/docs/compute-plans)

## Provider readiness

| Connection                             | Current implementation                                                                                                               | Required to complete                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paynow merchant activation and testing | Merchant integration 27861 was approved and live prepaid checkout was enabled. A simulated checkout was confirmed before going live. | Verify a legitimate live purchase and settlement before claiming live payments were tested.                                                                                                            |
| Paynow automatic renewals              | Prepaid Pro entitlements support repeat purchases.                                                                                   | Merchant tokenization permission, recurring billing consent, cancellation controls, and signed renewal reconciliation. [Paynow API](https://developers.paynow.co.zw/docs/paynow/initiate_transaction/) |
| Transcription, translation and AI      | Captions can be edited locally. AI record drafts are implemented for configured workspaces.                                          | Media transcription and translation jobs, provider credentials, usage limits and output review.                                                                                                        |
| Video rendering and private uploads    | Clip planning and small private attachments are available.                                                                           | Private object storage, upload scanning, media worker and secure delivery.                                                                                                                             |
| Portals, seller checkout and booking   | Expiring client reviews and collections, manual product delivery, and guest booking slots are available.                             | Persistent customer portal, seller payment routing, automatic fulfillment and recurring availability.                                                                                                  |
| Email, SMS and calendar                | Opt-in invoice email jobs and calendar file export are implemented.                                                                  | Verified sender for email delivery, SMS account and calendar OAuth connections.                                                                                                                        |
| Team, account recovery and files       | Workspace roles, authenticator recovery codes and small attachments are available.                                                   | Verified email reset flow and private storage for larger files.                                                                                                                                        |

The status panel uses runtime configuration for Paynow, AI and email. A configured provider can still reject a request. Keep credentials in the hosting environment and use the provider's supported test environment for integration tests.

## Gmail invoice reminder test

Business Workspace can use the Gmail API for a test in the sender mailbox. Use a
Desktop app OAuth client in a Google Cloud project with the Gmail API enabled.
If the project is in Testing, add the sender Gmail account as a test user.
Download the client JSON outside the repository. From the repository root, run
the helper with an output path in a private folder outside the repository.

```powershell
node scripts/authorize-gmail.mjs "$env:USERPROFILE\Downloads\client_secret.json" "$env:USERPROFILE\gmail-reminder-token.env"
```

Open the printed URL, sign in as the sender, and grant the send-only permission.
Set these values in the Render service environment.

- `INVOICE_REMINDER_PROVIDER=gmail`
- `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` from the downloaded JSON
- `GMAIL_REFRESH_TOKEN` from the helper output file
- `REMINDER_FROM_EMAIL` set to the bare sender Gmail address
- `INVOICE_REMINDER_WORKSPACES` set to the test workspace ID

After redeploying, create a new active, unpaid invoice due today, set the
recipient to the sender mailbox, and enable email reminders. Check the job
history and the sender mailbox after the next scheduled run. Keep the credentials
out of Git and chat. External Google projects in Testing generally issue Gmail
refresh tokens that expire in seven days. See [Google token expiry](https://developers.google.com/identity/protocols/oauth2#expiration).
