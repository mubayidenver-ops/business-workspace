# Business Workspace — proposed design

Status: proposed; application implementation has not started.

## Product
A responsive web application bringing 30 business services into one workspace. Initial audience: freelancers and small agencies. One account, shared clients, projects and files; separate tools with explicit availability and usage limits. English first, international date/time and currency support; payments and languages expand according to provider availability.

## Approach
Recommended: a modular application with a shared database and job queue. This keeps the first release manageable while allowing tools to evolve independently. Alternatives: independent apps joined by a portal (more operational overhead), or a third-party integration directory (faster but less control). The requested product is the modular application.

## Shared foundation
Accounts, organisations, role-based membership, client records, projects, uploads, notifications, audit history and workspace settings. All records and background jobs are scoped to an organisation. Private client review links are revocable, expire and are limited to the relevant item. A dashboard shows recent work, deadlines, usage and tool search. Navigation groups tools into Websites, Clients, Operations, Files, Content, Learning and Commerce.

## Module scope
1. Uptime: scheduled HTTP checks, incident history and notification preferences.
2. Broken links: bounded crawl, status results and CSV export.
3. Page changes: scheduled snapshots, comparison and change history.
4. Domain/certificate expiry: expiry records, supported lookups and reminders; unknown results are explicit.
5. Client approvals: versions, comments, approval state and scoped review links.
6. Onboarding: brief templates, responses, attachments and completion status.
7. Invoice follow-up: invoice records, balances, reminder schedules and delivery history; external payments are reconciled through verified events.
8. Proposals: line items, currency, totals, status and printable export.
9. Bookings: availability, time-zone-aware slots, cancellation and prevention of double bookings.
10. Projects/profit: tasks, time, expenses, invoiced income and calculated margin.
11. Testimonials: request forms, moderation and consent before publishing.
12. Feedback: requests, votes, statuses and duplicate-vote protection.
13. Help centre: articles, categories, drafts and search.
14. Meeting actions: notes, manually editable action items, owners and due dates; AI extraction is optional.
15. Spreadsheet cleanup: CSV-first import, duplicate detection, whitespace cleanup, preview and export; XLSX added using a suitable parser.
16. CSV tools: quoted-field-aware parsing, delimiter conversion, column mapping and validation reports.
17. PDF workflows: upload, ordered merge/split and export, with supported limits stated.
18. Images: resize, crop, supported format conversion and download.
19. Catalogues: product records, layouts, branding and printable catalogue.
20. Brand assets: files, tags, palette, font references and approval status.
21. Captions: editable timestamped segments, SRT/VTT import/export; transcription and translation require connected processing.
22. Video clips: media upload, selected time ranges, queued render and download.
23. Podcasts: transcript editing, episode metadata and draft publishing; external publishing requires a connected destination.
24. Repurposing: source text, occupation templates, editable output and optional AI generation.
25. Quizzes: questions, answer keys, learner attempts and scoring.
26. Language practice: occupation-based exercises, answers and progress; optional speech processing.
27. Portfolios: projects, profile, theme and a published public page.
28. Digital storefront: products, checkout integration, verified payment fulfilment and expiring download links.
29. Licence renewals: vendors, seats, costs, expiry dates and reminders; never store raw licence secrets by default.
30. Equipment maintenance: assets, service schedules, completed service history and reminders.

## Architecture and data flow
Proposed stack: TypeScript web application with React, a server API, PostgreSQL, private object storage and a durable background worker. Final libraries and versions are selected and verified during implementation. Modules use shared authorisation and storage interfaces. The browser submits validated requests; the server checks membership, stores records, and queues expensive work. Workers persist progress and results; the interface shows queued/running/completed/failed states. Provider integrations are isolated behind adapters.

## Billing and automation
Proposed plans: Free, Starter, Business and Agency; prices remain unvalidated. Enforce entitlements and usage budgets on the server. Meter costly media and AI processing separately. Scheduled checks, reminders and subscriptions need deployed workers and configured providers. No simulated payment, email delivery, monitoring or generated media is presented as successful real activity.

## Delivery sequence
A. Shared foundation and dashboard with all 30 modules listed and clear capability states.
B. Client workflow: onboarding, proposals, projects, approvals and invoice records.
C. Local file tools and operational records, then website workers and notifications.
D. Connected media/AI services, public publishing and paid digital fulfilment.
All 30 services remain in the intended scope. Each release documents implemented functions and outstanding dependencies. Initial prototypes must be labelled and must not claim production readiness.

## Reliability and security
Server-side organisation isolation, private uploads, validated signed download links and audit events. Validate sizes and file types. Website fetches block private/local addresses, revalidate redirects, and use strict timeouts, crawl limits and response-size limits. Jobs have bounded retries and idempotency keys. Payment events have signature verification and duplicate-event protection. Secrets stay in server configuration and never in repository files. Provide deletion and export workflows; public sharing requires an explicit publish action.

## Errors and testing
Actionable field validation, clear unavailable-provider messages, retryable job failures and recoverable uploads. Verify access isolation, totals, time-zone booking conflicts, CSV quoting, upload access, fetch restrictions, job retries and payment-event idempotency. Run type checks, build checks and representative browser workflows. Production acceptance also requires real provider credentials, deployment configuration and integration checks.

## Review requested
Approve or amend the modular web application approach, shared foundation and delivery sequence before implementation. No paid providers or deployment purchases are authorised by this design.
