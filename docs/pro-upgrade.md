# Professional workflow upgrade

This release turns several record-only modules into connected workflows. It is not feature parity with every product across the 30 categories.

## Delivered

- Original public landing page with working sign-in and registration links, toolkit browsing, product copy, Open Graph metadata, a canonical homepage, sitemap and robots instructions. No invented customers, reviews or revenue metrics.
- Dashboard summaries for outstanding invoices separated by currency, recent client responses and a setup checklist based on real saved records.
- Itemised proposals and invoices: up to 40 lines, quantities, currency-specific rate precision, discounts and tax. Server-calculated totals use integer minor units and BigInt ratio calculations. Tax is applied after discount. Percentages support four decimal places; quantities support four decimal places. This is a simple user-entered tax percentage, not jurisdictional tax determination or payment settlement.
- Readable documents and browser Print / Save PDF. Existing fixed-total documents remain readable and editable.
- Proposal-to-invoice conversion creates a Draft, preserving priced items and currency. Request keys prevent accidental duplicate conversion on retry. It never marks an invoice paid or charges a customer.
- Expiring, revocable links for proposals, approvals, invoices, onboarding, individual portfolio projects, help articles, catalogue products, consented testimonials and individual monitor status pages.
- Link holders can approve a proposal/review, request changes, or submit a project brief. Responses are stored with the record and visible to the workspace owner. Each link accepts one response. This is not identity verification or a legally verified signature service.
- Password changes require the current password and invalidate every existing session. Forgotten-password recovery still requires email delivery infrastructure.

## Sharing boundaries

Sharing requires an explicit owner confirmation. Anyone possessing a link can see that selected content; workspace access remains authenticated. Link expiry options are 1, 7 or 30 days. Editing or archiving the record invalidates its previous link. Generating a replacement revokes the prior link. Testimonials require recorded permission before sharing.

Only allowlisted fields leave the workspace. Onboarding shares public instructions, not stored contact email or internal notes. Account identifiers, passwords, session tokens and internal response objects are excluded from public projections. Approval identities are self-reported by link holders.

Raw sharing tokens are generated once, returned only to the owner at creation, and stored only as hashes on the server. Shared URLs use a fragment; the API receives the token in a dedicated header rather than a logged query/path. Links are not included in backups or normal workspace-state responses. Share requests have rate limits; live capacity and paid provider limits still apply.

## Compatible deployment

Existing DynamoDB table keys, permissions and provisioned capacity are retained. No new tables, indexes, paid services or keys are created. Link records use the existing table and TTL. SQLite gains an additive sharing table for local development. Legacy sessions default to credential version zero and remain usable until password change. Existing data is preserved.

Free Render hosting can sleep, delaying the first visit and pausing scheduled website monitoring. The single-instance scheduler and in-memory rate limits do not promise global availability or abuse prevention. Low DynamoDB capacity can throttle traffic. Continuous monitoring and higher traffic require an appropriate production deployment.

## Benchmark and next delivery stages

Official product references informed the workflow priorities: Jobber's client hub supports reviewing quotes and requesting changes (https://www.getjobber.com/features/client-hub/); Better Stack documents monitoring and incident/status workflows (https://betterstack.com/docs/getting-started/welcome/). This release uses original design and implementation.

1. Merchant payment account, signed payment events, subscription entitlements and usage metering. A Mastercard card alone is not a connected merchant processor. Billing remains disabled.
2. Email delivery, verified email accounts, forgotten-password recovery and real reminder delivery.
3. Team invitations, roles, account deletion/privacy workflows and complete audit/event history.
4. Private file storage, multi-document client portals, public booking availability/calendar integration and full public help/portfolio collections.
5. Metered AI, transcription, translation and video rendering with provider-specific integrations.
6. Durable job scheduling, scalable paginated queries, deployment monitoring, localisation and measured production performance.

These are explicit unfinished stages, not buttons that pretend the service exists. Rankings, acquisition and revenue are not guaranteed by a UI upgrade.
