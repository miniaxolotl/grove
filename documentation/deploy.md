# Deployment and recovery

This is an operator procedure, **not live deployment status or authorization**.
Use the admitted source, current provider readbacks and private configuration.
Historical deployment IDs, test totals and provider observations are in the
[evidence archive](archive/README.md), not defaults to replay.

For a local, read-only comparison of a candidate with the last verified delivery
per destination, see [Preview release impact](development/release-impact.md).

## Topology and configuration

For offline rehearsal of a release PR's manifest edits and npm publication list,
see [Stage a selective release PR locally](development/selected-release-writer.md).

- Website: `https://grovenote.app`, Next.js on Vercel; production branch `production`.
- API: `https://api.grovenote.app`, Hono REST `/v1` and Streamable HTTP `/mcp`.
- Worker: same Node 24 image, separate `node dist/worker.js` command and database login.
- Database: PostgreSQL 17 with pgvector; migration owner separate from non-owner
  API/worker roles. Runtime rejects superuser, BYPASSRLS and table-owner credentials.

Use the repository's `.do/app.json` template and `scripts/deploy-digitalocean.mjs`
for provisioning; verify actual provider region, sizing, database retention and
connection budgets before changing them. Worker polling prevents assuming the
database mostly sleeps. [Capacity guidance](development/backend-capacity.md)
explains pools, admission and measured limits.

Secrets belong in Doppler/private ignored 0600 files, never source, plans, screenshots
or command arguments. Keep API, worker, website and migration-owner configuration
separate. A saved secret is not deployed configuration. Image-only updates preserve
existing encrypted provider settings; they do not install missing keys or enable flags.

### Identity and website

API configuration uses `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_ISSUER`,
`CLERK_WEBHOOK_SIGNING_SECRET`, exact `SITE_URL` and `API_ORIGIN`. Website uses
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `GROVE_API_URL`, `SITE_URL`,
and sign-in/up routes `/sign-in` and `/sign-up`. The target production issuer is
`https://clerk.grovenote.app`; development uses a separate instance.

Configure Clerk webhook delivery to `/v1/webhooks/clerk` for `user.created`,
`user.updated`, `user.deleted`, `session.revoked`, `session.ended`, `session.removed`.
Verify actual signed delivery, event ordering and session revocation; key presence
or configuration inspection is not a live test.

Agent OAuth uses S256 PKCE, `openid offline_access`, opaque tokens for online
revocation and the exact **`API_ORIGIN/mcp`** resource audience. Enable the audience
claim; DCR defaults to `openid` and permits `openid`/`offline_access`. Clerk identity
scopes do not grant note access: Grove Connections grants remain mandatory. See
[agent setup](cloud-onboarding.md), [social sign-in](social-sign-in.md) and
[hosted chats](hosted-chat.md) for callbacks, provider setup and acceptance limits.

Private pages/BFF responses stay uncached and unindexed; public sharing stays outside
Clerk/analytics. Redact capability paths in edge/provider logs, not only application
telemetry. Keep Cloudflare email obfuscation **off** for `grovenote.app`: rewriting
contact text before hydration can break legal pages. Review them in a real browser
after edge changes.

### Domain cutover

1. Attach `api.grovenote.app` to the existing DigitalOcean app as an alias and
   publish its DNS-only CNAME. Verify TLS and `/health/ready` on both API hosts.
   A healthy alias alone does not change OAuth discovery or token audiences.
2. On the **existing** Clerk production instance, move the primary domain,
   verify its DNS and TLS, and coordinate the exact callbacks with Google,
   GitHub, Microsoft and Apple (including private relay). Record the previous
   settings for rollback. Do not create a new instance or change Apple or
   Firefox application IDs. Communicate the need to sign in again.
3. Coordinate the production Doppler configs, DigitalOcean API/worker origins
   and issuer, Clerk publishable keys, and Vercel production environment. Remove
   the redirect **from** `grovenote.app` so release preflight can read the existing
   deployment directly. Keep legacy website hosts serving it during verification.
   Rebuild the website with the new origin and key. Verify sign-in, an authenticated API
   read, an existing share, and a new MCP authorization with the exact resource
   `https://api.grovenote.app/mcp`. Existing agent grants may require reconnecting.
4. Verify the new apex serves the admitted release, then configure one-hop
   308 redirects on `usegrove.cloud`, `usegrove.ca`, `usegrove.one` and their
   `www` names, and on `www.grovenote.app`. Check an install or support path with
   a query string from each. Do not redirect API, Clerk, mail or preview hosts
   to the website. Check clients with a cached redirect from the old rollout.
5. If a gate fails, keep or restore the working host before redirecting traffic.
   Restore the matching provider origins, keys and website build together; never
   configure reciprocal redirects. Leave old API DNS in service during migration.

## Self-hosted Compose

```sh
cp .env.example .env
# Generate independent POSTGRES_PASSWORD, API_DATABASE_PASSWORD,
# WORKER_DATABASE_PASSWORD and CURSOR_SECRET with openssl rand -hex 32.
# Fill Clerk settings and exact origins in the private .env file.
docker compose up -d --build
curl --fail http://localhost:26080/health/ready
```

PostgreSQL has no published port; API binds loopback for a TLS reverse proxy. The
one-shot migrate service applies forward schema and bootstraps `grove_api`/`grove_jobs`;
it does not implicitly rotate existing role passwords. API/worker never get owner
credentials. Named volumes retain database/model/source data; do not delete them
to troubleshoot a rollout.

For managed PostgreSQL, run the built `dist/migrate.js`, then `dist/bootstrap.js`
with the migration owner, or equivalent reviewed owner SQL. Use runtime-role URLs
for services and `DATABASE_SSL=require` with a trusted CA. Do not disable certificate
verification. First local model download needs writable cache and at least 180s
startup allowance. `EMBEDDING_MODE=disabled` explicitly selects lexical operation;
providers/dimensions never silently fall back. See [models](models.md).

## Release and rollout

1. Merge feature PRs into protected `development`. For website-only admission,
   CI fetches the candidate and each distinct receipt ancestor's frozen pnpm
   dependencies into one store, then builds fresh archives with offline installs.
   Missing inputs, unreviewed fingerprints or changed service artifacts block
   this route. An earlier coordinated exception cannot authorize a new source.
   Merge the Release Please PR,
   then wait for its immutable source tag and independent full-source CI.
2. Dispatch **Select Release Candidate** on development with that exact tag. It
   opens frozen `promote/production/vX.Y.Z`; later development commits are excluded.
   Verify source/tree, Release Please, policy/tooling and operator-run evidence.
   Expired evidence requires refreshing the original selection run, not moving refs.
3. Before an incompatible rollout, follow [schema upgrades](operations/schema.md):
   inspect actual applied history, verify a retained backup and isolated restore,
   pause/drain old writers and apply pending forward migrations using the owner.
   Review the changed features' own rollout requirements; do not blindly run old
   migration examples or mix incompatible API/worker generations.
4. Require strict `CI Gate` and resolved conversations; promotion uses a **merge
   commit**, never bypass/force. [Release conventions](release-conventions.md) owns
   naming/version policy; [pipeline conventions](pipeline-conventions.md) owns CI.
5. Production **Deploy** admits exact released source, probes its required database
   schema with both runtime roles, preflights every npm tarball,
   publishes coordinated packages/images and deploys API/worker by immutable digest.
   Missing `DIGITALOCEAN_ACCESS_TOKEN`/`DIGITALOCEAN_APP_ID` is an error. Verify registry
   integrity, active provider generation, both component digests and readiness.
   After publication/image verification it attaches the admitted source's unsigned
   browser ZIPs and integrity metadata to the existing GitHub release, with direct
   links in its Downloads section. [Release downloads](release-conventions.md#release-downloads)
   defines same-byte reuse, conflict handling and the boundary from store/live acceptance.
   Development does not publish or deploy. Existing previews need separate retirement.
6. Deploy's `website` job runs only after API/worker deployment and readiness pass.
   It checks out the admitted source, builds with Vercel's production configuration,
   deploys prebuilt output and verifies project/source metadata and public
   `/release.json` identity. A stale production ref or failed backend prevents the
   website job. Public variables are baked at build time.
7. Verify synthetic save → worker indexing → read, two-account/grant denial, current
   session revocation and affected feature journeys. Readiness is not full user,
   provider, privacy-log or physical-device acceptance. Record evidence in the
   release PR; leave unrun checks explicit.

### Read-only schema preflight

Configure GitHub's protected production environment with `GROVE_API_DATABASE_URL`
and `GROVE_WORKER_DATABASE_URL`, matching the actual provider API/worker runtime
connections. Use the existing `grove_api`/`grove_jobs` non-owner logins, the same
database endpoint/name and `sslmode=verify-full`; keep owner credentials out of CI.
These settings are required, not implied by a DigitalOcean secret being present.

`node --import tsx scripts/release/database-preflight.mjs` reuses the admitted
source's `probeDatabase` in bounded **read-only transactions**, before publication
and again immediately before rollout. It closes both pools, rejects unsafe or
mismatched targets, and fails closed without logging connection values. It never
runs migrations or repairs grants. Configure private network reachability/trusted
TLS before enabling the production job; do not bypass a failed check.

For `action_usage.units` failures, inspect applied history: migration
`20261025_033_ai_cache` already provides that column and preserves historical
action counts. Apply the admitted source's pending migrations through the reviewed
[schema-upgrade procedure](operations/schema.md), including backup/restore and
writer coordination. Do not add a duplicate column migration, weaken runtime
readiness, or infer that this source change migrated the live database.

Five bundled packages/native-marketplace pins share one Release Please-owned version.
Do not hand-bump versions or publish changed bytes under an existing version.
`node scripts/publish.mjs --dry-run` preflights without publishing. For partial
publication, recheck the protected production head, frozen source and observed
predecessor before each authorized batch. Match the main image on GHCR and Docker
Hub, private checker digest, five npm integrities and release ZIP checksums against
the admitted build. Once the rejection is resolved, an authorized retry of Deploy
on the same current production commit can reuse identical artifacts. Conflicting
bytes require a new reviewed release. Never move a tag/frozen head. ZIPs do not
establish store delivery.

A successful DigitalOcean proposal followed by a rejected app update is not a
deployment. Record the PUT timestamp, status and request ID if available. Ask
provider support for the rejected field/reason; do not replay a write to collect
diagnostics or log the spec, raw response or encrypted settings. Read back pending
and ACTIVE deployments before recovery. For a coordinated rollout require API and
worker on the main digest and the private checker on its own digest, then check
readiness and the selected website's live manifest. A healthy older API can return 200.

### Expected-state provider fence

Selected hosted delivery can pass `--expected-app-state <sha256>` to
`scripts/deploy-digitalocean.mjs`. Its exported `appStateFingerprint(app)` returns
64 lowercase hex characters: SHA-256 of canonical JSON containing the app ID,
complete desired spec, and active/pending/in-progress generation IDs and phases.
Object keys are sorted recursively; array order is preserved. Missing generations
and null generations are equivalent. Specs and encrypted settings stay in memory;
do not log them or treat the fingerprint as authorization.

With this flag, the first app GET and the final pre-PUT GET must match that
fingerprint. Both reads also require an ACTIVE generation, no pending/in-progress
generation, identical desired and active specs, and only the existing `api` service
and `worker`. Extra services, jobs, static sites, functions and databases are held;
creation and checker options are rejected. Drift fails closed and requires a new
authorized preflight, not a blind retry. An already-ACTIVE exact spec/image is a
no-op before proposal or PUT, including with `--wait`.

Without the flag, existing provisioning and rollout behavior is unchanged. This
client-side read fence is not an atomic provider compare-and-swap and does not
remove the need for serialized authorized writers or post-write verification.
It neither diagnoses nor repairs the historical proposal-success/HTTP-400 rejection.

### Coordinated Vercel delivery

The GitHub production environment requires `VERCEL_TOKEN` (a Vercel access token
scoped to this project), `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Pass these through
the CLI environment; do not add `--scope`, which resolves user/team resources that
project-only tokens cannot access. Keep credentials out of command arguments.
Preflight verifies the exact project,
team, `packages/website` root and production environment keys before publication.
The project is `bramble-labs-inc/grove` (`prj_AAHDflaS5lkamhL46o3kAwRx2YKL`).
Configure its ignored-build command as `exit 0` and retain
`packages/website/vercel.json` with `git.deploymentEnabled: false`. These prevent
independent Git builds; `gitProviderOptions.createDeployments` only controls GitHub
deployment records. The pinned CLI builds locally and publishes prebuilt output.
Retain existing deployments and aliases while preparing this cutover. The Vercel
CI token and DigitalOcean account must be operational before promoting this path.

### Feature requirements

Change only the owning guide when a feature's rollout changes:

| Area                                        | Canonical guide                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Models, preferences and exact AI cache      | [Models](models.md), [AI caching](ai-caching.md)                                                     |
| Jobs, storage and transactional email       | [Jobs](jobs.md), [background services](background-services.md)                                       |
| Images, original audio and generated speech | [Media](media.md), [recordings](recordings.md), [speech](speech.md)                                  |
| Public capabilities and expiration          | [Sharing](sharing.md)                                                                                |
| Notebooks                                   | [Lifecycle](notebook-lifecycle.md), [organization](notebook-organization.md)                         |
| Ask, context and documents                  | [Ask tools](ask-tools.md), [context](explicit-context.md), [imports](imports.md)                     |
| Search and relationship-policy cutover      | [Search](search.md), [relationships](relationships.md)                                               |
| Billing, access and reporting               | [Billing](billing.md), [administration](system-administration.md), [reports](admin-usage-reports.md) |

## Operating checks and rollback

```sh
curl --fail https://api.grovenote.app/health/ready
curl -i https://api.grovenote.app/v1/me
# Without credentials: 401 and private, no-store.
```

Inspect actual API/worker logs, ready/active generations, failed tasks, database
capacity, broker fallback and lifecycle-webhook backlog. Logs must omit content,
credentials, recipients and capability URLs. Graceful worker shutdown needs at
least 40s; lease recovery is not proof of lossless hosted draining.

Existing-app updates preserve domains, sizing and encrypted settings. Propose first:

```sh
node --env-file=.env.digitalocean.local scripts/deploy-digitalocean.mjs \
  --app-id YOUR_VERIFIED_APP_ID --digest sha256:YOUR_PUBLISHED_DIGEST --propose
# An explicitly authorized deployment uses the same inputs without --propose, with --wait.
```

Rollback is an explicit operator operation to a verified last-good digest compatible
with the **current** forward schema, configuration, grants, queue and feature protocols.
Drain/fence incompatible writers first. Retain schema/data; an old bootstrap image
is not a default recovery target. Automatic last-good rollback/desired-state recovery
and hosted failure drills are **not implemented/qualified** by current rollout fences.

## Backups and deletion

Application deletion **hides retained authored records/history**; it is not physical
erasure. Derived vectors/cache, abandoned staging and expired exports may be cleaned.
Already delivered copies and provider backups cannot be recalled. See
[retained deletion](jobs.md#retained-deletion) and [media recovery](media.md#exports-and-recovery).

1. Verify the provider's current PITR/retention window; do not assume a 30-day backup.
   Keep independent operator backups encrypted with access/expiry controls. Back up
   PostgreSQL **and** immutable source objects/checksums; DB-only is not media-complete.
2. Restore offline into `grove_restore` or a uniquely named `_test` database. Use
   PostgreSQL 17 `pg_dump --format=custom` / `pg_restore --exit-on-error` or verified
   provider PITR. Preserve ownership, runtime groups/grants, extensions/functions/RLS.
   Outside Neon omit only its provider-specific `cloud_admin` ACLs if necessary.
3. Apply matching forward migrations. Restore and verify every ready source object's
   bytes/checksum before reads. Keep a complete trustworthy **current authority** DB;
   if unavailable, the restore stays offline. Fence application mutations for final
   reconciliation and retain/replay incoming lifecycle events.
4. Load owner URLs `RECOVERY_AUTHORITY_DATABASE_URL` and `RECOVERY_TARGET_DATABASE_URL`
   from a private 0600 env file, then run:

   ```sh
   node --env-file=.env.recovery.local --import tsx scripts/database/reconcile-restore.ts
   ```

   Authority is read-only. The target replays current tombstones, revocations,
   support/role/grant decisions and review state; invalidates old credentials,
   pending work, mutation receipts, derived results and exports; and fences notebook
   cursors/Undo. Matching migrations and complete authority are mandatory.

5. Keep billing/provider traffic off until an owner separately reconciles current
   Stripe customers/subscriptions/tombstones. A restored billing receipt is not
   payment authority. Verify non-owner RLS, second-account denial, revoked content,
   worker/readiness and feature recovery. Reissue keys/reapprove OAuth, rotate the
   cursor secret, reconcile the event backlog, then cut over runtime URLs.

Logical restore tests do not qualify regional disaster recovery or provider PITR.
No down-migration, retained-source deletion or privilege weakening is a recovery step.
