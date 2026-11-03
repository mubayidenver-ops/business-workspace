# Verification — development release 0.1

- TypeScript check and Vite production build: passed. Main JavaScript bundle approximately 307 kB before compression; PDF processing is loaded separately.
- Node test suite: 18 tests passed, none failed. Covers private account isolation, invalid authentication, cross-origin rejection, record creation and editing, optimistic concurrency, archive/restore, invoice validation, booking conflicts, idempotent votes and create retries, blocked unsafe website checks, malformed URL recovery, logout, CSV parsing/cleanup/formula-safe export, and all 30 module definitions.
- Premium UI static audit: passed with zero findings. Static evidence does not prove rendered accessibility or keyboard behavior.
- Prettier formatting check: passed; subsequent backend fixes were formatted again.
- npm dependency audit at installation: zero reported vulnerabilities.
- Live public website smoke check: example.com returned HTTP 200 and a certificate expiry value through the pinned-address website fetcher.
- Browser inspection: unavailable because local browser use is disabled in Work settings. Responsive layout, focus behavior, native popups, downloads and complete browser flows still need visual/interaction verification before release.
- Deployment and paid integrations: not performed. The missing capabilities are listed in release-status.md.

No real customer records, account databases, payment credentials or API keys are included in the repository.
