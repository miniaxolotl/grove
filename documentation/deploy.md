# Deployment and recovery

This is an operator procedure, **not live deployment status or authorization**.
Use the admitted source, current provider readbacks and private configuration.
Historical deployment IDs, test totals and provider observations are in the
[evidence archive](archive/README.md), not defaults to replay.

## Topology and configuration

- Website: `https://usegrove.cloud`, Next.js on Vercel; production branch `production`.
- API: `https://api.usegrove.cloud`, Hono REST `/v1` and Streamable HTTP `/mcp`.
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
and sign-in/up routes `/sign-in` and `/sign-up`. Production issuer is
`https://clerk.usegrove.cloud`; development uses a separate instance.

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
telemetry. Keep Cloudflare email obfuscation **off** for `usegrove.cloud`: rewriting
contact text before hydration can break legal pages. Review them in a real browser
after edge changes.

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

1. Merge feature PRs into protected `development`. Merge the Release Please PR,
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
5. Production **Deploy** admits exact released source, preflights every npm tarball,
   publishes coordinated packages/images and deploys API/worker by immutable digest.
   Missing `DIGITALOCEAN_ACCESS_TOKEN`/`DIGITALOCEAN_APP_ID` is an error. Verify registry
   integrity, active provider generation, both component digests and readiness.
   Development does not publish or deploy. Existing previews need separate retirement.
6. Deploy the compatible Vercel website after API/worker. Public variables are baked
   at build time. Any manual deployment must use a clean archive of the promoted
   production commit, not a worktree containing ignored private artifacts.
7. Verify synthetic save → worker indexing → read, two-account/grant denial, current
   session revocation and affected feature journeys. Readiness is not full user,
   provider, privacy-log or physical-device acceptance. Record evidence in the
   release PR; leave unrun checks explicit.

Five bundled packages/native-marketplace pins share one Release Please-owned version.
Do not hand-bump versions or publish changed bytes under an existing version.
`node scripts/publish.mjs --dry-run` preflights without publishing. For partial
publication rerun Deploy on the same current production commit: identical artifacts
are reused; conflicts need a new release. Never move a tag/frozen head.

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
curl --fail https://api.usegrove.cloud/health/ready
curl -i https://api.usegrove.cloud/v1/me
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
