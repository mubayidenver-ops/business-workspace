# Verification — development release 0.1

## DynamoDB update — 2026-11-03

- Default suite: 19 passed, 0 failed; DynamoDB-specific suite intentionally skipped unless local DynamoDB is requested.
- `npm run test:dynamodb`: 22 passed, 0 failed against Amazon DynamoDB Local. Includes the full authenticated API flow plus concurrent duplicate creation, concurrent booking conflicts, multi-client stale edits, archive/restore registry changes, booking restoration conflicts, expired sessions, workspace isolation and queries crossing the 1 MB response boundary.
- TypeScript and production build: passed.
- Render Blueprint: validated against the current downloaded Render JSON schema. It targets Free compute, existing DynamoDB storage and no disk; secret values are not included.
- Premium UI static audit: zero findings. Rendered browser interactions are still not verified.
- AWS cloud table access, IAM permissions in the real account, billing eligibility and public deployment: not tested. No real AWS credentials were available to this runtime, and no cloud data was modified. Credentials must be configured securely on the host before claiming a live connection.

The original verification below records the first local release.

- TypeScript check and Vite production build: passed. Main JavaScript bundle approximately 307 kB before compression; PDF processing is loaded separately.
- Node test suite: 18 tests passed, none failed. Covers private account isolation, invalid authentication, cross-origin rejection, record creation and editing, optimistic concurrency, archive/restore, invoice validation, booking conflicts, idempotent votes and create retries, blocked unsafe website checks, malformed URL recovery, logout, CSV parsing/cleanup/formula-safe export, and all 30 module definitions.
- Premium UI static audit: passed with zero findings. Static evidence does not prove rendered accessibility or keyboard behavior.
- Prettier formatting check: passed; subsequent backend fixes were formatted again.
- npm dependency audit at installation: zero reported vulnerabilities.
- Live public website smoke check: example.com returned HTTP 200 and a certificate expiry value through the pinned-address website fetcher.
- Browser inspection: unavailable because local browser use is disabled in Work settings. Responsive layout, focus behavior, native popups, downloads and complete browser flows still need visual/interaction verification before release.
- Deployment and paid integrations: not performed. The missing capabilities are listed in release-status.md.

No real customer records, account databases, payment credentials or API keys are included in the repository.
