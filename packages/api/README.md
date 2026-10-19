# Grove server

Private PostgreSQL memory API and leased job worker. Requires Node 24, pgvector,
separate non-owner API/worker database roles, and a dedicated Clerk application.

See [hosting](https://github.com/miniaxolotl/grove/blob/development/documentation/deploy.md)
and [API contracts](https://github.com/miniaxolotl/grove/blob/development/documentation/server.md).
Start `node dist/server.js`; run `node dist/worker.js` separately. Migrations and
bootstrap are explicit owner-credential commands. No automatic data reset occurs.
