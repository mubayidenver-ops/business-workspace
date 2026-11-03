# DynamoDB storage

The app supports the existing `business-workspace` table in `eu-north-1`, using String partition key `pk` and String sort key `sk`. No secondary indexes are needed. The app does not create tables or change billing settings. Keep Standard table class, provisioned 5 read / 5 write units, and auto scaling off if targeting the free allowance. Other account usage, optional features and account eligibility can affect costs; this is not a guarantee of a zero bill.

## Server configuration

```text
STORAGE_BACKEND=dynamodb
AWS_REGION=eu-north-1
DYNAMODB_TABLE=business-workspace
```

The AWS SDK uses its default server-side credential provider chain. Prefer an AWS IAM role/short-lived credentials on a compatible AWS host. On an external host, configure a dedicated identity restricted to this table. `aws/dynamodb-policy.json` is a policy template; replace YOUR_AWS_ACCOUNT_ID with the account containing the table. It permits only the data operations used by the app, not table creation, scans or billing changes.

If using access keys on Render, enter AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY directly in the Render Environment page or Blueprint secret prompts. Add AWS_SESSION_TOKEN only if using temporary credentials, and arrange renewal before expiry. Do not use root keys, paste credentials into chat, commit them, or put them in frontend variables. The app never returns credential values to the browser.

In the DynamoDB table's Additional settings, enable Time to Live with attribute `ttl`. Session expiration is checked in code immediately even before TTL deletes an item. Website-check history has a seven-day TTL; up to 200 recent results are displayed. Expired items can remain physically stored until TTL deletion runs; enabling TTL is necessary to prevent obsolete items accumulating indefinitely.

Startup checks table availability and key types. Missing credentials, the wrong region/table, or denied permissions stop DynamoDB startup. There is no automatic fallback to a disposable SQLite database when DynamoDB is selected. The health endpoint verifies database read access without exposing records.

## Data model and safeguards

- Account profiles use `ACCOUNT#email` / `PROFILE`, with a conditional transaction preventing duplicate registration. Passwords remain salted hashes.
- Workspace records use `WORKSPACE#userId` / `RECORD#recordId`. All user-facing reads are scoped to the authenticated account.
- A workspace META revision is updated transactionally alongside record writes. Consistent reads and optimistic revision checks prevent conflicting edits, over-capacity record creation and overlapping bookings, including concurrent creates and restores.
- Idempotency keys use REQUEST items. Feedback votes use VOTE items, protected by the same workspace transaction.
- Hashed sessions use a separate SESSION partition and an expiry timestamp.
- Website-check history and latest-check pointers are isolated by workspace. A compact MONITORS partition supports scheduled checks without table scans or a paid secondary index.
- Queries paginate through DynamoDB's response-size boundary. The development limit remains 1,000 records per workspace. Full-workspace snapshot reads are appropriate for small development workspaces; larger workloads need a paginated backend and narrower queries. Low provisioned capacity can throttle traffic; failed requests are not silently reported as saved.

## Local data and migration

Local development defaults to the existing SQLite database. Its accounts and records are preserved; no local data is deleted or uploaded by this change. A new DynamoDB database starts with new workspaces. Moving existing local accounts/history requires a deliberate migration before switching an established deployment. The in-app JSON export is not a complete authentication database migration.

## Tests

`npm test` exercises the local SQLite path and shared rules. To exercise DynamoDB itself, run Amazon DynamoDB Local on port 8000, then `npm run test:dynamodb`. The test runner uses fake credentials, creates randomly named local test tables, runs API and concurrency checks, then deletes only those test tables. It rejects non-local test endpoints and never targets your cloud table. DYNAMODB_TEST_ENDPOINT can override the local test URL.

For interactive local DynamoDB development, set NODE_ENV=development and DYNAMODB_ENDPOINT=http://127.0.0.1:8000 alongside the storage variables. Endpoint overrides are rejected in production.

## Hosting

The Render Blueprint now targets a Free web service with DynamoDB and no persistent disk. The free service sleeps when idle; in-process uptime/change monitoring pauses while it sleeps. It is a development/preview deployment, not continuous monitoring or a production availability guarantee. Hosting and AWS each have their own quotas and possible charges. Cloud connection and public deployment remain unverified until credentials are configured and a live smoke test is performed.
