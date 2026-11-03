# Business Workspace

A connected workbench for independent businesses, with 30 module workspaces for clients, operations, files, content, learning, commerce and websites.

**Development release.** Real local accounts and persistent records, working file utilities and bounded website checks. Billing, public portals and automatic media/AI providers are not connected. See [exact capability status](docs/release-status.md) before using the app.

## Run locally

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

No paid API keys are required for the implemented utilities. No code here enables payment collection. Website checks allow public IPv4 HTTP/HTTPS on standard ports, limit response sizes and redirects, and keep up to 30 results per record. Timers stop when the server stops.

## Structure

- `src/`: React/TypeScript interface, shared editors and browser utilities
- `shared/`: module registry and CSV processing
- `server/`: local authentication, validation, SQLite and safe website requests
- `tests/`: meaningful domain and API regression tests
- `docs/`: approved product design, implementation plan and release boundaries

The intended production architecture is React/TypeScript, PostgreSQL, private object storage and durable background jobs. The current Node/SQLite implementation makes the first release runnable without purchasing services; it is not a substitute for those production dependencies.

Do not commit `.env`, the database, account exports or real customer data. No deployment has been made automatically.
