# Verification

Use Node 24 and pnpm 10.33. All database tests require an explicitly named disposable
database ending in `_test`. No test drops a configured application database.

```sh
pnpm install --frozen-lockfile
docker run -d --name grove-memory-test -p 127.0.0.1:26432:5432 \
  -e POSTGRES_DB=grove_test -e POSTGRES_PASSWORD=grove_disposable_test pgvector/pgvector:0.8.2-pg17
export TEST_MIGRATION_DATABASE_URL=postgresql://postgres:grove_disposable_test@127.0.0.1:26432/grove_test
export TEST_DATABASE_URL=postgresql://grove_api:grove_disposable_api@127.0.0.1:26432/grove_test
export TEST_WORKER_DATABASE_URL=postgresql://grove_jobs:grove_disposable_worker@127.0.0.1:26432/grove_test
pnpm test:db:setup
pnpm check-types
pnpm lint
pnpm build
pnpm test
pnpm test:artifacts
pnpm lint:website
pnpm check-types:website
pnpm build:website
pnpm --filter website exec playwright install chromium
pnpm test:website
docker build -t grove-memory:test .
```

The contract suite uses real pgvector, migrations, **non-owner API/worker roles**,
real HTTP requests and the official MCP transport. It covers cross-account access,
scoped keys/OAuth grants, signed JWT validation, replay/version conflicts,
archive/restore/deletion, worker races, handoff retention and account tombstones.
Identity fixtures do not replace required live Clerk sign-in/OAuth tests.

Artifact tests pack all distributables and execute them in isolated directories,
with no workspace source, lifecycle build or database. They initialize stdio MCP,
invoke tools through an authenticated HTTP fixture, check truthful status and
preserve unrelated configuration on repeated setup/uninstall. Native-host smoke
tests supplement these, as recorded in [delivery evidence](../delivery.md).

Website browser tests cover public routes, accessibility, keyboard navigation,
installation copy and metadata. Dashboard fixture tests use the real components
with a test-only HTTP fixture, separate from production routes. Live account tests
must verify sign-up → save → dashboard → MCP → second-account denial and logout.

For a disposable Clerk development account, complete `grove login --client cli`
and approve a grant in Connections. Save a personal memory containing `concise`.
With an isolated `GROVE_CONFIG_HOME`, the API environment and Clerk development
keys loaded, run `GROVE_LIVE_TEST=1 pnpm exec tsx scripts/testing/live-connection.ts`.
This exercises real refresh rotation, exact audience rejection, account-admin
denial, HTTP/stdio MCP recall and private-context suppression. It changes the
test credential's expiry to force refresh. Never point it at a customer account.
Add `GROVE_LIVE_REVOKE=1` to finish by revoking the Grove connection and Clerk
access/refresh tokens and removing the local credential. Sign in and explicitly
reapprove the connection before repeating that check.
