# Hosting and releases

## Topology

- Next.js website: **https://usegrove.cloud** on Vercel, production Clerk and an authenticated BFF.
- Hono API: **https://api.usegrove.cloud**, REST `/v1`, MCP `/mcp` on DigitalOcean App Platform.
- Worker: separate process for leased embeddings, retention and account deletion.
- Neon PostgreSQL 17 + pgvector 0.8.0: migrations and non-owner runtime roles.

Production is deployed in New York, near Neon's AWS US East 1 database.
One 1-vCPU/1-GB API and one matching worker cost **$20/month combined**, plus Neon
usage. Worker polling keeps the database active; do not budget it as mostly asleep.
The published Node 24 image runs both components. Compose remains available for
self-hosting with pgvector 0.8.2. See [delivery evidence](delivery.md).

`usegrove.one`, `usegrove.ca`, `grovenote.app` and the four `www` names redirect
with HTTP 308 to `usegrove.cloud`. Porkbun hosts DNS; Vercel handles these redirects.

## Clerk

Grove application `app_3KtGcnwE2Yg0P34l9PVij7LnOTS` has separate development and
production instances. Production issuer: `https://clerk.usegrove.cloud`;
development issuer: `https://wanted-bison-3950.clerk.accounts.dev`.
Pull production keys with `clerk env pull --app app_3KtGcnwE2Yg0P34l9PVij7LnOTS
--instance prod --file /absolute/path/to/.env.clerk.production.local`.
Secrets belong in ignored 0600 files, the private `secrets.md` inventory and provider
secret stores. `usegrove.app` was a provisional mistake and is no longer configured.

API environment: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_ISSUER`,
`CLERK_WEBHOOK_SIGNING_SECRET`, exact `SITE_URL` and `API_ORIGIN`.
Website environment: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`GROVE_API_URL` and `SITE_URL`. Publishable keys are public; secret keys are not.
Sign-in/up routes are `/sign-in` and `/sign-up`; signed-in library is `/app`.

Configure Svix delivery to `API_ORIGIN/v1/webhooks/clerk` for `user.created`,
`user.updated`, `user.deleted`, `session.revoked`, `session.ended` and
`session.removed`. Ban/lock updates are ordered; deletion tombstones win over stale
events. Production endpoint `ep_3KtwL4AVpXAPBCGY4n5WalA3TVP` has its actual signing
secret configured in both components. Live user/session delivery and deletion pass.
Email/password authentication is enabled; Google login awaits provider credentials.

For OAuth, enable provider client registration (or register supported public clients)
with PKCE S256, refresh tokens, scopes `openid offline_access`
and resource audience **`API_ORIGIN/mcp`**. CLI callbacks use loopback
`http://127.0.0.1:34141/callback` (CLI), 34142 (OpenCode), 34143 (Claude), 34144
(Codex). Metadata discovery and the SDK perform registration/authorization/refresh;
Grove verifies resource and client grant before data access. Clerk does not accept
custom memory scopes: capabilities are approved in Grove Connections instead.
Enable `aud_claim_enabled`, keep opaque access tokens for online revocation checks,
and set DCR `default_scopes` to `["openid"]` and `dynamic_client_allowed_scopes`
to `["openid", "offline_access"]`. Production issuance, exact resource binding,
refresh rotation and provider revocation pass. Consent remains required, followed
by an explicit Grove connection grant. See the browser-automation qualification in
[delivery evidence](delivery.md#hosted-production-verification).

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

## Neon + DigitalOcean + Vercel

### Resources and provisioning

- Neon project `rapid-meadow-36605074`, branch `br-calm-king-b7b0fvqj`.
  Database `grove`; `grove_owner` is migration-only; runtime logins are `grove_api`
  and `grove_jobs`. Compute scales between 0.25 and 1 CU.
- DigitalOcean app `3aef47f9-3724-4f21-9cad-8c4eb5644af0`, region `nyc`.
  Default ingress `grove-rgiwo.ondigitalocean.app`; DNS `api` is a CNAME to it.
- Vercel project `prj_AAHDflaS5lkamhL46o3kAwRx2YKL`, team `bramble-labs-inc`,
  root `packages/website`, Node 24, production branch `production`.

`.do/app.json` is the bootstrap template. `scripts/deploy-digitalocean.mjs` adds
runtime variables and validates it with DigitalOcean before creating/updating the
app. Initial provisioning needs:

| Variable                                    | Value                                                            |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `DIGITALOCEAN_ACCESS_TOKEN`                 | Grove operator's provider token                                  |
| `GROVE_API_DATABASE_URL`                    | `grove_api` login, `sslmode=verify-full&channel_binding=require` |
| `GROVE_WORKER_DATABASE_URL`                 | Separate `grove_jobs` login with the same TLS settings           |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Matching production instance keys                                |
| `CLERK_WEBHOOK_SIGNING_SECRET`              | Actual Svix endpoint signing secret                              |
| `CURSOR_SECRET`                             | Shared random value, at least 32 characters                      |
| `API_ORIGIN`, `SITE_URL`, `CLERK_ISSUER`    | Optional overrides of the production origins above               |
| `GROVE_IMAGE_DIGEST`                        | Optional SHA-256 override of the template's published image      |

With those variables in private environment files, validate before first creation:

```sh
# Initial setup: DIGITALOCEAN_APP_ID must be unset.
node --env-file=.env.digitalocean.local --env-file=.env.neon.local \
  --env-file=.env.clerk.production.local scripts/deploy-digitalocean.mjs --propose
node --env-file=.env.digitalocean.local --env-file=.env.neon.local \
  --env-file=.env.clerk.production.local scripts/deploy-digitalocean.mjs --create --wait
```

The script never sends migration-owner credentials. Database URLs, Clerk secrets
and the cursor key are `SECRET`/`RUN_TIME` values. The API and worker receive only
their own database login. `DATABASE_SSL=require` verifies certificates. These
providers communicate over authenticated public TLS, not a shared private VPC.

The API uses readiness `/health/ready`, liveness `/health/live`, and a 180-second
startup allowance. Model cache is writable but ephemeral; restarts may download
the fixed model again. The worker uses the same image/profile with
`node dist/worker.js`. App Platform edge caching is disabled for REST/MCP.

### Rollout and rollback

GitHub secret `DIGITALOCEAN_ACCESS_TOKEN` and variable `DIGITALOCEAN_APP_ID` are set
on `miniaxolotl/grove`. After this hosting PR reaches `production`, the Deploy
workflow publishes the image and rolls both components to the resulting digest.
Development pushes publish preview images. Vercel follows the production branch.
Database migrations remain an explicit owner-credential operation before rollout.

Existing-app updates preserve provider-encrypted secrets, domains and sizing:

```sh
node --env-file=.env.digitalocean.local scripts/deploy-digitalocean.mjs \
  --app-id 3aef47f9-3724-4f21-9cad-8c4eb5644af0 \
  --digest sha256:YOUR_PUBLISHED_DIGEST --propose
# Repeat without --propose and with --wait to deploy.
```

Rollback uses the same command with a previously healthy digest after confirming
schema compatibility. Forward migrations are not automatically reversed. Initial
healthy image: `sha256:884593cd2e9b50528d1421371fcbb77e804d0af357336d6d494da3a2e4585fff`.

Update website variables in Vercel's **production** environment and redeploy:
`SITE_URL=https://usegrove.cloud`, `GROVE_API_URL=https://api.usegrove.cloud`,
the production Clerk keys, and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` /
`NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`. Public keys are included at build time.
Private `/app` pages and BFF replies are uncached and omitted from indexing;
analytics are mounted only in marketing.

### Operating checks

```sh
curl --fail https://api.usegrove.cloud/health/ready
# Expected: {"status":"ready","semantic":"enabled"}
curl -i https://api.usegrove.cloud/v1/me
# Expected without credentials: 401, Cache-Control: private, no-store
```

Check API and worker runtime logs in App Platform, readiness, failed job counts,
database capacity and Svix delivery attempts. Successful readiness includes the
non-owner database probe and embedding startup. A test memory reaching
`indexing: ready` verifies the worker. Logs must omit customer content and tokens.

## Backups and deletion

Neon's configured point-in-time history is **86,400 seconds (one day)**. There is
no separate snapshot schedule or 30-day backup retention configured. Confirm this
window in Neon before choosing a restore point. Operator exports need their own
encrypted storage, access restrictions and expiry policy.

Permanent application deletion removes live content, revisions, vectors and
pending jobs. It cannot immediately rewrite historical provider backups or copies
already delivered to agents. Recovery must replay newer privacy decisions:

1. Restore into an isolated database named `grove_restore` (or ending in `_test`),
   with API/worker traffic stopped. Use Neon branching/PITR or PostgreSQL 17
   `pg_dump --format=custom` / `pg_restore --exit-on-error`. Restore the owner,
   runtime groups, grants, pgvector extension, functions and RLS policies. When
   restoring outside Neon, omit only provider-specific `cloud_admin` default ACLs;
   preserve Grove's ownership and runtime grants.
2. Apply the same forward migrations. Use a trusted CA bundle for `verify-full`
   TLS; PostgreSQL client images may lack one. Keep backups private.
3. Keep a current, trustworthy authority database available. Stop application
   mutations for final reconciliation, retain incoming Clerk lifecycle events,
   and replay them before reopening traffic. If current deletion authority is
   unavailable, keep the restore offline until it can be recovered.
4. Set owner connections `RECOVERY_AUTHORITY_DATABASE_URL` (current source) and
   `RECOVERY_TARGET_DATABASE_URL` (isolated restore) in an ignored 0600 env file:

   ```sh
   node --env-file=.env.recovery.local --import tsx scripts/database/reconcile-restore.ts
   ```

   The source transaction is read-only. The target transaction replays permanent
   memory/account tombstones, identity state and session revocations, purges
   dependent content, clears cached mutation results and invalidates **all** old
   grants/API keys. Missing authority accounts or mismatched migrations fail closed.

5. Verify non-owner roles/RLS, two-account isolation, deletion absence, worker jobs
   and readiness. Reissue API keys and reapprove OAuth connections. Rotate the
   cursor secret for the recovered deployment, then update both runtime URLs and
   cut over only after the authority/event backlog is reconciled.

A real Neon dump was restored into isolated PostgreSQL on 2026-10-19. The drill
verified post-snapshot memory/account deletion, real session-revocation webhook
replay, old-credential invalidation and tenant isolation. This exercised logical
restore; Neon in-place PITR and regional disaster recovery were not exercised.

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

The PostgreSQL migration release is tracked in
[PR #4](https://github.com/miniaxolotl/grove/pull/4): CLI and OpenCode **0.5.0**,
with the new server, Claude and Codex packages at **1.0.0**. Native manifests and
marketplace pins match their npm package versions. The one-time `release-as`
overrides are retired with the explicit version updates. In release-please,
extra-file paths are package-relative; root marketplace paths need a leading `/`.

Review versions and marketplace pins, require green release PR checks, then merge
into `development` to create GitHub releases. Promote that release to `production`
to publish npm artifacts and versioned container images. Verify registry versions,
integrity and installation after publication. Package publication and live data
migration are separate rollout steps.
