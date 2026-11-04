# Business Workspace

Designed by **lordyvites** · [GitHub profile](https://github.com/mubayidenver-ops).

A connected workbench for independent businesses, with 30 module workspaces for clients, operations, files, content, learning, commerce and websites.

**Development release.** Real local accounts and persistent records, working file utilities and bounded website checks. Itemised proposals/invoices, expiring client approval and brief links, dashboard insights and password changes are implemented. Billing and automatic media/AI providers are not connected. See [the professional workflow upgrade](docs/pro-upgrade.md). See [exact capability status](docs/release-status.md) before using the app.

**Security and public pages:** Protect sign-in with an authenticator app, and publish a feedback board, testimonial wall, help centre, status page and weekly-availability booking page per workspace. See `docs/release-status.md`.

## Run locally

**Billing integration:** Paynow hosted purchases now support 30-day Pro access, signed confirmations and private purchase history. Payments stay disabled until merchant setup and provider testing are complete. See [billing activation and limits](docs/billing.md). Automatic recurring debits are not enabled.

**DynamoDB cloud storage is now supported.** The hosting configuration targets your `bussiness-workspace` table in `eu-north-1`, with no paid disk. Configure server-side AWS access before deployment; see [DynamoDB setup and limitations](docs/dynamodb.md). The local defaults below preserve existing SQLite data.

Requires Node.js 24 or newer and npm.

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3000 and create your own workspace. No default credentials or sample customer records are installed. Data is stored under `data/workspace.sqlite`, which is excluded from Git. Back up this directory while the server is stopped, or use a proper SQLite online backup tool. The in-app JSON export is useful for reviewing records but is not an automatic restore format.

For live development, use `npm run dev`. `npm test` runs API, isolation, validation and file parsing checks. `npm run check` checks frontend types. `npm run format:check` checks formatting.

## Configuration

| Environment variable | Default        | Purpose                                                         |
| -------------------- | -------------- | --------------------------------------------------------------- |
| PORT                 | 3000           | HTTP listen port                                                |
| HOST                 | 127.0.0.1      | Local-only by default; set 0.0.0.0 inside a configured host     |
| DATA_DIR             | ./data         | Persistent database directory                                   |
| APP_URL              | request origin | Exact trusted public origin, e.g. https://workspace.example.com |
| COOKIE_SECURE        | false          | Set true behind HTTPS in production                             |

Cloud storage additionally uses `STORAGE_BACKEND=dynamodb`, `AWS_REGION=eu-north-1`, and `DYNAMODB_TABLE=bussiness-workspace`, plus secure server-side AWS authentication. No code here enables payment collection. Website checks allow public IPv4 HTTP/HTTPS on standard ports and limit response sizes and redirects. SQLite retains 30 checks per record; DynamoDB uses seven-day TTL history and shows the latest 200 checks per workspace. Timers stop when the server stops or the hosting service sleeps.

## Structure

- `src/`: React/TypeScript interface, shared editors and browser utilities
- `shared/`: module registry and CSV processing
- `server/`: local authentication, validation, SQLite and safe website requests
- `tests/`: meaningful domain and API regression tests
- `docs/`: approved product design, implementation plan and release boundaries

The app uses React/TypeScript with server-side DynamoDB for the requested cloud deployment, and SQLite for local development. Private object storage and durable background jobs are future production capabilities. The free hosting configuration is for preview/development and does not provide continuous monitoring.

Do not commit `.env`, the database, account exports or real customer data. No deployment has been made automatically.
