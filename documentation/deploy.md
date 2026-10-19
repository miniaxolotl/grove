# Hosting and releases

## Topology

- Next.js website: existing Vercel deployment, Clerk accounts, authenticated BFF.
- Hono API: REST `/v1`, MCP `/mcp`, content-free health/diagnostic output.
- Worker: separate process for leased embeddings, retention and account deletion.
- Private PostgreSQL 17 + pgvector 0.8.2: migrations and non-owner runtime roles.

The repository provides Compose, a Node 24 Debian image, and separate Railway API/
worker configurations. Live Grove Railway resources and production domains are
not configured yet; see [delivery evidence](delivery.md). The connected Railway
workspace currently exposes FITR projects only. Do not reuse their database or keys.

## Clerk

Use a dedicated Grove application for each environment. The implementation created
development application `app_3KtGcnwE2Yg0P34l9PVij7LnOTS`, issuer
`https://wanted-bison-3950.clerk.accounts.dev`. Obtain its secret in the dashboard or
run `clerk auth login`, then `clerk env pull --app app_3KtGcnwE2Yg0P34l9PVij7LnOTS`.
Put secrets only in ignored environment files or the hosting secret store.

API environment: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_ISSUER`,
`CLERK_WEBHOOK_SIGNING_SECRET`, exact `SITE_URL` and `API_ORIGIN`.
Website environment: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`GROVE_API_URL` and `SITE_URL`. Publishable keys are public; secret keys are not.
Sign-in/up routes are `/sign-in` and `/sign-up`; signed-in library is `/app`.

Configure Svix delivery to `API_ORIGIN/v1/webhooks/clerk` for `user.created`,
`user.updated`, `user.deleted`, `session.revoked`, `session.ended` and
`session.removed`. Ban/lock updates are ordered; deletion tombstones win over stale
events. Test retries and account deletion on the actual development instance.

For OAuth, enable provider client registration (or register supported public clients)
with PKCE S256, refresh tokens, scopes `openid offline_access`
and resource audience **`API_ORIGIN/mcp`**. CLI callbacks use loopback
`http://127.0.0.1:34141/callback` (CLI), 34142 (OpenCode), 34143 (Claude), 34144
(Codex). Metadata discovery and the SDK perform registration/authorization/refresh;
Grove verifies resource and client grant before data access. Clerk does not accept
custom memory scopes: capabilities are approved in Grove Connections instead.
Enable `aud_claim_enabled`, keep opaque access tokens for online revocation checks,
and set DCR `default_scopes` to `["openid"]` and `dynamic_client_allowed_scopes`
to `["openid", "offline_access"]`. Development issuance, exact resource binding,
refresh rotation and provider revocation passed live verification. Repeat these
checks against the production instance and origins before public activation.

## Compose

```sh
cp .env.example .env
# Generate four independent values with openssl rand -hex 32:
# POSTGRES_PASSWORD, API_DATABASE_PASSWORD, WORKER_DATABASE_PASSWORD, CURSOR_SECRET
# Fill Grove Clerk keys, issuer, webhook secret and origins.
docker compose up -d --build
curl --fail http://localhost:26080/health/ready
```

PostgreSQL has no published port. API binds loopback for a local TLS reverse proxy.
The one-shot `migrate` service applies forward migrations and idempotently creates
non-owner `grove_api`/`grove_jobs` logins. Existing role passwords are not rotated
implicitly. API/worker never receive owner credentials. Named volumes preserve
database and model data. `docker compose down` keeps data; deleting volumes erases it.

For a managed database, run the built `dist/migrate.js` with a migration-owner URL,
then `dist/bootstrap.js` to create the runtime roles, or use equivalent operator
SQL. Runtime `DATABASE_URL` must be non-owner/non-superuser/non-BYPASSRLS.
`DATABASE_SSL=require` validates TLS certificates. On a private encrypted network,
configure the provider's documented transport appropriately; do not disable
certificate verification. Pgvector extension/role creation needs owner privileges.

API starts with `node dist/server.js`; worker with `node dist/worker.js`.
Both use the same model profile and a writable model-cache path. The image uses
CPU inference; it neither patches SDK dependencies nor downloads CUDA providers.
`EMBEDDING_MODE=disabled` explicitly selects lexical-only operation. The local
profile never silently falls back to another provider or dimension.

Readiness waits for database-role checks and embedding initialization. Configure
at least 180 seconds of initial startup time for first model download. Health
responses contain no customer data. Reverse proxy access logs must omit bodies,
authorization headers and search queries; use POST search.

## Railway + Vercel

Create a Grove-specific project in the intended workspace, a private pgvector
database, API and worker services. Select `packages/api/railway.toml` and
`packages/api/railway-worker.toml` as service config paths, with repository root as
build context. Set private database URLs and separate runtime users. Run migrations
as an explicit owner-credential job before rollout, not in every web process.
Expose only the API HTTPS domain. Attach model-cache volumes where supported.

Set the website's environment in Vercel. Both website origin and API origin must
match the Clerk and API configuration exactly. Private `/app` pages and BFF replies
are uncached and omitted from indexing; analytics are mounted only in marketing.

## Backups and deletion

Enable encrypted provider volumes and scheduled PostgreSQL backups. A proposed
operator policy is 30-day backup expiry; configure and verify the actual provider
retention before launch. Permanent application deletion removes live rows,
revisions, vectors and pending jobs in one transaction. It cannot delete copies
already delivered to agents or immediately rewrite historical provider backups.

For restore: isolate the restored database, apply migrations, replay deletion and
revocation tombstones newer than the snapshot from the current authority store,
validate tenant isolation, and only then reopen traffic. Do not bring an old backup
online with old connection grants. A production recovery exercise and automated
tombstone replay are release gates, not claims of completed hosted verification.

## Releases

`pnpm build` prebuilds API, CLI, OpenCode and native Claude/Codex executables.
`pnpm test:artifacts` packs each package and tests it away from the source tree.
Marketplace manifests carry pinned versions; release-please updates package and
plugin manifest versions together. Publication to npm is on the `production`
branch through `scripts/publish.mjs`, after build/type/artifact checks. CI also
checks PostgreSQL/RLS, HTTP/MCP, website and image build on pull requests.
The publisher preflights all tarballs against registry integrity before the first
upload, rejecting changed contents under an existing version. Use
`node scripts/publish.mjs --dry-run` to check the release without publishing.

Release PR #4 predates this change and currently proposes the legacy CLI's 0.4.0
release. Merge this feature first, then let release-please regenerate #4: the
existing CLI and OpenCode packages explicitly target **0.5.0** for this breaking
migration. The version manifest retains the published 0.3.1/0.3.2 baseline until
that release PR merges. Include the new server/Claude/Codex packages and verify
their marketplace versions before promoting the release to `production`.
Remove the temporary `release-as` entries after 0.5.0 ships. Never publish this
feature branch directly with its historical package versions; npm publication
and live data migration are separate rollout steps.
