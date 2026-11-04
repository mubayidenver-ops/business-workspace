# Upgrade scope and verification

This release extends Business Workspace in place. It keeps the existing React and Node application, account isolation, SQLite development store, DynamoDB production store and Paynow billing. The linked OpsKit pack describes a separate enterprise stack. Moving existing accounts, records and paid entitlements to that stack would require a migration project.

| Module                 | Available workflow                                                                                   | Remaining gap                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Uptime                 | Configurable intervals, incident transitions, history, private status links and a downloadable badge | Always-on workers and external delivery                                 |
| Broken links           | Bounded same-origin crawl with redirect deduplication and referring pages                            | Large or JavaScript-rendered sites                                      |
| Website changes        | Normalized text, region markers, ignored lines, stored previews and in-app alerts                    | Browser-rendered snapshots and external delivery                        |
| Domain and certificate | TLS expiry, manually tracked registration date, explicit unknowns and in-app lead time               | Registration lookup and threshold delivery                              |
| Equipment              | Asset and location records with configurable due reminders                                           | Recurring service jobs and work orders                                  |
| Approvals              | Version-scoped guest review, downloadable small attachment and one recorded decision                 | Large media, annotations and comment threads                            |
| Onboarding             | Drafts, reusable questions, required answers and private guest attachments up to 32 KiB              | Large uploads and configurable field types                              |
| Quotes                 | Line items, expiry, saved revisions and print-to-PDF                                                 | Custom branded templates and automatic PDF delivery                     |
| Testimonials           | Consent and individual share links                                                                   | Public collection campaign                                              |
| Feedback               | Request records and idempotent voting                                                                | Public boards and team participation                                    |
| Help centre            | Searchable records and individual guide links                                                        | Public collection and indexing                                          |
| Brand assets           | Tagged links and usage notes                                                                         | Large private asset library                                             |
| Invoices               | Reference, amounts, currency and optional in-app reminders that pause on payment or request          | Automated email and client invoice collection                           |
| Projects               | Revenue, expenses and labor cost using billable hours and a recorded hourly cost                     | Timesheets and portfolio-wide profit reporting                          |
| Licence renewals       | Costs, seats and early in-app reminders                                                              | Renewal automation                                                      |
| Appointments           | Internal appointments, UTC storage, local display, conflict-safe buffers, edits and cancellation     | Public availability and calendar sync                                   |
| Meeting actions        | Assignment and due records                                                                           | Meeting capture and task extraction                                     |
| Spreadsheet cleanup    | Local CSV cleaning and export                                                                        | XLSX workbook support                                                   |
| CSV                    | Local validation, conversion and export                                                              | Large-file processing                                                   |
| PDF                    | Local merge and extraction                                                                           | Industry templates and OCR                                              |
| Product images         | Local resize and formatting                                                                          | Batch background processing                                             |
| Catalogues             | Product records, print and individual links                                                          | Public multi-product storefront                                         |
| Captions               | Local SRT editing and SRT/WebVTT export                                                              | Automatic transcription and translation                                 |
| Clips                  | Source and time-range planning                                                                       | Highlight detection and rendering                                       |
| Podcasts               | Text export and expiring read-only transcript links                                                  | Automatic transcription and external publishing                         |
| Repurposing            | Local content templates                                                                              | Provider-backed rewriting                                               |
| Quizzes                | Local quiz creation, export and scoring                                                              | Hosted courses and learner progress                                     |
| Language               | English hospitality exercises                                                                        | More occupations, translations and speech evaluation                    |
| Portfolio              | Printable records and individual project sharing                                                     | Public portfolio sites                                                  |
| Digital store          | Product preparation records                                                                          | Seller checkout, payment reconciliation and protected download delivery |

Platform additions include a Needs attention list, Ctrl/Cmd+K tool search and automated GitHub checks. Remaining platform work includes organization roles, Postgres RLS, SSO/MFA/SCIM, durable queues and private object storage, advanced billing, tenant-scoped AI, expanded localization and accessibility verification, regional hosting, analytics, disaster recovery and launch operations.

Run `npm test` and `npm run build`. For DynamoDB coverage, start a local emulator and run the full Node test suite with `NODE_ENV=test` and `DYNAMODB_TEST_ENDPOINT` set to its loopback URL. The suite never uses a production table. The final storage run passed 53 tests.

To verify the workflows, open Website tools, create an active uptime monitor and run a check. Try the broken-link checker on a public same-origin fixture and review referring pages. Create a quote, revise its total and open its history to print the earlier revision. Create an onboarding draft with questions, share it and submit a completed brief using the guest link. In-app notifications reflect recorded check events and date reminders.

Rollback by redeploying the previous Git revision in Render. Database changes are additive. Prior versions of the app ignore the extra quote history and record fields.
