# Development release

## Paynow billing integration — 2026-11-03

Authenticated billing, hosted checkout integration, signed callbacks, payment history and 30-day Pro entitlements are implemented. Payments remain disabled because merchant setup and live provider tests are unfinished. This is prepaid access, without automatic renewals. See [billing setup and precise boundaries](billing.md). This supersedes earlier statements that no billing code exists.

## Professional workflow update — 2026-11-03

The new landing page, itemised documents, proposal-to-invoice conversion, revocable client links, client responses, dashboard summaries and password changes are implemented. See [delivered features and limits](pro-upgrade.md). This update supersedes the historical initial-release list below for those capabilities. Billing remains disabled pending a merchant payment provider.

## DynamoDB update — 2026-11-03

The requested DynamoDB adapter is implemented for cloud storage. Local development retains SQLite and its existing records. Hosting configuration now selects DynamoDB in `eu-north-1` and a Free Render instance without a paid disk. Accounts, sessions, records, idempotent writes, feedback and website-check history use the selected database. See [DynamoDB configuration](dynamodb.md) for authentication, expiry, costs and remaining live-verification requirements. The original release list below describes the initial local implementation; cloud connectivity and public deployment are not claimed until tested with securely configured host credentials.

This is a runnable first development release, not a launched paid service. All 30 tools have module-specific record management. The complete original scope remains in docs/design.md; a saved record screen does not imply every service is finished.

## Implemented

- Account registration/sign-in, hashed passwords, hashed cookie sessions, rate-limited authentication and same-origin mutation checks.
- One private workspace per account, persistence in SQLite, owner-scoped queries, validated fields and optimistic version checks.
- All 30 module record screens: create, edit, search, pagination, archive, restore and CSV export.
- Invoice balance and project profit calculations; quotation amounts and printable records.
- Appointment conflict prevention; due-date notifications displayed in-app.
- Feedback votes: one per account in the app, and one per browser on the public feedback board.
- Account security: authenticator-app (TOTP) two-factor sign-in with replay protection and 8 single-use recovery codes, sign out of every session, and password-confirmed account deletion that removes the owner's workspace and team memberships. Public pages and booking availability are managed by the workspace owner.
- Public workspace pages (one link per type, replaceable): feedback board with voting and moderated submissions, testimonial wall with moderated consented submissions, searchable help centre, uptime status page, and a booking page.
- Bookings: weekly availability windows in a chosen time zone (DST-aware) with slot length, buffer, minimum notice and horizon; guests receive a private link to reschedule or cancel.
- Projects: per-project timesheets (billable/non-billable hours, billable rate) and a cross-project profit report with per-currency totals and CSV export.
- Equipment: work orders, service logging that advances the next due date and closes the linked work order, and service history.
- Spreadsheet cleanup imports .xlsx workbooks (any worksheet) in the browser without uploading them.
- CSV parsing with quoted cells and multiline fields, trim/deduplicate, inconsistent-column warnings and formula-safe export.
- PDF merge and page extraction; PNG/JPG/WebP input with proportional PNG/JPG resize output.
- SRT editing and SRT/WebVTT export, local content templates, quiz creation/session scoring/JSON export and three English hospitality exercises.
- On-demand bounded website checks, 20-link scans, page hashes and certificate inspection. Public IPv4 only; unsafe destinations and redirect targets are blocked. Active uptime/change monitors run in-process while the server is running (up to 50 global monitors, development limit). No availability SLA or durable worker queue.
- Manual licence/domain/equipment renewal records, brand asset links, video clip plans, episode transcripts, internal articles, product and portfolio records.

## Not implemented / not connected

- Subscriptions, checkout, refunds and verified paid download fulfilment. The app cannot collect revenue yet.
- Email/SMS delivery, calendar integrations, automatic transcription/translation, AI generation and video rendering.
- Hosted portfolios, storefront and external podcast publishing.
- File uploads/private object storage, password reset/email verification, and email delivery of team invitations or booking confirmations (links are copied and sent manually).
- PostgreSQL and durable distributed jobs. The approved production architecture is documented; SQLite and an in-process scheduler are a deliberate development bootstrap.
- Complete curriculum, multiple language support, advanced quotation line items, XLSX export and payroll-grade time accounting.

## Data lifecycle and production boundary

Accounts see only their own records and checks. Archive is reversible indefinitely while the local database exists. There is no permanent deletion UI; server administrators manage the development database. Backups include private business data and must be stored safely. Files processed by utilities are not uploaded to the server. The server database and authentication cookies must never be committed.

Use local test data first. Before public launch: deploy HTTPS, enable secure cookies, set APP_URL, add account recovery/deletion, strengthen production abuse limits, implement team permissions if needed, migrate persistence and workers as required, establish backups and privacy/retention terms, configure and test real providers, and obtain appropriate security/commerce review. These are launch dependencies, not a claim of compliance.
