# Upgrade scope and verification

This release extends Business Workspace in place. It keeps the existing React and Node application, account isolation, SQLite development store, DynamoDB production store and Paynow billing. The linked OpsKit pack describes a separate enterprise stack. Moving existing accounts, records and paid entitlements to that stack would require a migration project.

| Module                 | Available workflow                                                                                   | Remaining gap                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Uptime                 | Configurable intervals, incident transitions, history, private status links and a downloadable badge | Always-on workers and external delivery                                 |
| Broken links           | Bounded same-origin crawl with redirect deduplication and referring pages                            | Large or JavaScript-rendered sites                                      |
| Website changes        | Normalized text, region markers, ignored lines, stored previews and in-app alerts                    | Browser-rendered snapshots and external delivery                        |
| Domain and certificate | TLS expiry, RDAP registration lookup, manual override and in-app lead time                           | Scheduled registry checks and threshold delivery                        |
| Equipment              | Asset records, lead reminders and recurring dates after service completion                           | Work orders and automatic job dispatch                                  |
| Approvals              | Version-scoped guest review, downloadable small attachment and one recorded decision                 | Large media, annotations and comment threads                            |
| Onboarding             | Drafts, reusable questions, required answers and private guest attachments up to 32 KiB              | Large uploads and configurable field types                              |
| Quotes                 | Line items, expiry, saved revisions and print-to-PDF                                                 | Custom branded templates and automatic PDF delivery                     |
| Testimonials           | Consent and individual share links                                                                   | Public collection campaign                                              |
| Feedback               | Request records and idempotent voting                                                                | Public boards and team participation                                    |
| Help centre            | Searchable records and selected shared collections                                                   | Permanent public hosting and indexing                                   |
| Brand assets           | Tagged links and usage notes                                                                         | Large private asset library                                             |
| Invoices               | Invoice references, balances, in-app reminders and optional Resend email                             | Sender setup and client invoice collection                              |
| Projects               | Revenue, expenses and labor cost using billable hours and a recorded hourly cost                     | Timesheets and portfolio-wide profit reporting                          |
| Licence renewals       | Costs, seats, early reminders and recurring dates after renewal                                      | Vendor integrations and payment automation                              |
| Appointments           | Recurring slot reservations, single-slot and group booking links, UTC storage and calendar export    | Indefinite availability schedules, guest rescheduling and calendar sync |
| Meeting actions        | Assignment and due records                                                                           | Meeting capture and task extraction                                     |
| Spreadsheet cleanup    | Local CSV cleaning and export                                                                        | XLSX workbook support                                                   |
| CSV                    | Local validation, conversion and export                                                              | Large-file processing                                                   |
| PDF                    | Local merge and extraction                                                                           | Industry templates and OCR                                              |
| Product images         | Local resize and formatting                                                                          | Batch background processing                                             |
| Catalogues             | Product records, print and searchable shared collections                                             | Public multi-product storefront                                         |
| Captions               | Local SRT editing and SRT/WebVTT export                                                              | Automatic transcription and translation                                 |
| Clips                  | Source and time-range planning                                                                       | Highlight detection and rendering                                       |
| Podcasts               | Text export and expiring read-only transcript links                                                  | Automatic transcription and external publishing                         |
| Repurposing            | Local content templates                                                                              | Provider-backed rewriting                                               |
| Quizzes                | Local quiz creation, export and scoring                                                              | Hosted courses and learner progress                                     |
| Language               | English hospitality exercises                                                                        | More occupations, translations and speech evaluation                    |
| Portfolio              | Printable records and searchable shared collections                                                  | Permanent custom-domain sites                                           |
| Digital store          | Product records and expiring manual delivery links for small files                                   | Seller checkout, automatic fulfillment and large files                  |

Platform additions include a Needs attention list, Ctrl/Cmd+K tool search and automated GitHub checks. Remaining platform work includes organization lifecycle management, Postgres RLS, SSO/SCIM, durable queues and private object storage, advanced billing, tenant-wide AI search and automation, expanded localization and accessibility verification, regional hosting, analytics, disaster recovery and launch operations.

Run `npm test` and `npm run build`. For DynamoDB coverage, start a local emulator and run the full Node test suite with `NODE_ENV=test` and `DYNAMODB_TEST_ENDPOINT` set to its loopback URL. The suite never uses a production table. The final storage run passed 64 tests.

To verify the workflows, open Website tools, create an active uptime monitor and run a check. Try the broken-link checker on a public same-origin fixture and review referring pages. Create a quote, revise its total and open its history to print the earlier revision. Create an onboarding draft with questions, share it and submit a completed brief using the guest link. In-app notifications reflect recorded check events and date reminders.

Rollback by redeploying the previous Git revision in Render. Database changes are additive. Prior versions of the app ignore the extra quote history and record fields.

## Booking, collections and digital delivery

Create an active appointment with Offer this slot selected. A share link expires before the appointment starts and confirms one guest. Calendar export creates an ICS file. For help, portfolio and catalogue records, select up to 12 additional records in the Share dialog. A selected record changing invalidates the collection link. To deliver a digital product, attach a supported file up to 32 KiB, then share its expiring link with the recipient. For paid products, the seller confirms payment separately. Paynow remains the billing provider for Workspace Pro.

## Invoice reminder setup

Email delivery is off unless Render has `RESEND_API_KEY`, `REMINDER_FROM_EMAIL` (a verified sender) and `INVOICE_REMINDER_WORKSPACES` (comma-separated workspace owner IDs). Owner IDs are available in the signed-in workspace state. Provision only the workspaces authorised to send invoice reminders. Store credentials in Render's secret environment values. An eligible invoice is active, unpaid, unpaused and explicitly opted in with a client email and due date. The service checks every 15 minutes while running, using UTC date thresholds. It claims at most one delivery per invoice and due date, retries a transient provider error once with the same idempotency key, and avoids re-sending an uncertain delivery on a later cycle. Resend calls were simulated in tests. Use the Resend dashboard to confirm delivery. Remove the server settings to turn email off.

Provider documentation: [send email](https://resend.com/docs/api-reference/emails/send-email) and [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Teams, AI drafts and renewals

Open Teams and workspaces from the sidebar workspace switcher. Ask an existing account holder for the email and account ID shown in their account settings. A workspace owner can grant viewer or editor access and revoke it. Billing, guest sharing, archiving, manual website checks and scheduled invoice emails stay owner-only. The recipient chooses a joined workspace from the same menu. Recent grants, role changes and revocations are recorded for the owner. This version uses application roles and supports authenticator MFA for local accounts.

To enable AI drafts for specified workspaces, configure `OPENAI_API_KEY`, `OPENAI_MODEL` and comma-separated owner IDs in `AI_WORKSPACES` in Render. Drafting is off until all settings are present. Owners can generate drafts or summaries for proposals, invoices, meetings, feedback, testimonials and repurposing. They review the exact notes before sending. Only those notes go to the provider. Outputs are editable downloads. They do not change records or send messages. Provider calls were simulated during tests. [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

On Equipment or Software renewals, set the repeat interval and use Record completion. The app saves the completion date and calculates the next due date from it. On Domain and certificate tracker, enter the registered domain and run a check. A manual date overrides registry lookup. Missing registry or certificate dates display as unknown. [IANA RDAP bootstrap](https://www.iana.org/assignments/rdap-dns)

On Appointment booking, use **Reserve recurring slots** to save 2–13 daily, weekly or fortnightly slots in one transaction. A conflict rejects the full series. Share an offered slot and select additional times to publish an expiring group link. Guests see the remaining slots in their local time zone. Each slot can be claimed once. Revoking the group link stops further bookings.

## Two-step sign-in

Open Workspace settings → Two-step sign-in. Verify the current password, add the setup key to a time-based authenticator, and confirm a current code. Save the one-use recovery codes before signing in again. Enabling or disabling MFA invalidates existing sessions. The app rejects reused time steps and atomically consumes recovery codes.

Deploy with a stable 32-byte hex `MFA_ENCRYPTION_KEY` in the host secret settings. Preserve that key with your recovery materials. Recovery codes are stored as hashes. The authenticated setup key is encrypted at rest. Roll forward with an MFA-aware version after anyone enrolls. Earlier builds do not enforce the new sign-in policy.
