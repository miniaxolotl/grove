# Hosting and releases

Follow [shared release/naming conventions](release-conventions.md): patch-first
automatic versions, explicit `Release-As` minor/major/breaking decisions, concise
conventional commit/PR names and immutable promotion refs. Coordinated package and
marketplace version mappings remain part of the single root release.

Shared workflow names, action pins, runtime and evidence conventions follow the
[cross-repository CI/CD baseline](pipeline-conventions.md).

The [Grove hardening review](development/cicd-hardening-review.md) distinguishes
implemented digest-bound rollout/readiness from planned selection, draining and
fenced automatic last-good recovery. Those controllers are not activated by this
documentation refresh.

## Topology

### Billing rollout (023)

Billing source does not authorize a production migration, Stripe live-mode change
or charging customers. Follow [billing configuration and limits](billing.md).

1. Back up the database; apply forward `20261024_023_billing` after 022 using the
   owner connection. It adds billing tables/functions without rewriting retained
   notes, accounts or existing usage. Do not reverse the migration.
2. Keep `billing-enabled=false`. Install matching API/worker binaries and configure
   the same Vercel SDK key, Stripe mode/credentials, Pro prices and allowances.
   `BILLING_CONFIGURED=true` requires the billing schema at runtime startup.
   Image-only deployments do not infer or activate these variables.
3. Configure Stripe's customer portal, tax/legal/payment/receipt settings and the
   signed API webhook endpoint. Use test mode and an internal Vercel flag cohort
   first. Deploy the matching website with flag integration, not Stripe secrets.
4. Verify Free usage, owned Checkout, completed payment → Pro, duplicate/lost
   responses, signed webhook retry/reordering, period-end cancellation, past-due
   downgrade, reset dates, API/worker quotas and account-deletion cancellation.
   Confirm a second account and agent credentials cannot manage another customer.
5. Enable the intended cohort only after real Stripe test-mode/provider checks.
   Live price selection, enablement and charging need separate operator approval.

Pause new sales/plan enforcement by turning the flag off, not by removing Stripe
credentials or downgrading to pre-billing binaries. Webhooks, existing-customer
portal access and deletion cancellation must continue; the flag does not stop
renewals. Existing safety limits remain. Retain provider billing records.

After database restore, keep the flag **off** and provider traffic fenced until an
owner reconciles customer mappings, subscriptions and deleted-account tombstones
against Stripe. Do not open new Checkout from a pre-billing/stale customer snapshot
or infer entitlement from restored rows/event receipts. Verify canonical status
with disposable accounts before reopening; restore is not payment reconciliation.

### Connection quality policy cutover

The substantive-bridge policy requires no new database migration. Coordinate the
matching API and worker application versions:

1. Pause enrichment dispatch and drain/stop every old worker consumer before
   enabling the new policy. Do not mix old/new relationship writers; profile-based
   job selection alone does not prevent old binaries overwriting canonical pairs.
2. Deploy the admitted matching API/worker image, then resume enrichment. Fresh
   reads use `relationships-v3-*`; old assessments stay retained but hidden until
   bounded reconciliation replaces them within existing budgets. Unchanged-source
   dismissals survive and old inspector revisions cannot act on new assessments.
3. Verify concrete positive links, template-only abstention, canonical graph/list
   agreement and stale cleanup-preview rejection using owned synthetic notes.
   No source edits, eager live reset/reindex or bulk all-pairs inference is needed.
4. For rollback, pause consumers again and coordinate API/worker rollback. Retain
   notes and review state; do not reverse migrations or run mixed policy writers.

Older binaries do not understand policy-aware dismissal carryover. Do not resume
old enrichment writers assuming reviews will remain effective after their next
assessment. Prefer a compatible forward fix, or keep enrichment paused until an
explicitly reviewed rollback/review-state procedure is available.

See [connection processing and recovery](relationships.md#migration-and-recovery).

### Speech rollout (019)

Back up retained source objects and the database together. After 018, apply forward
`20261023_019_speech` with the owner connection during the migration window; runtime
readiness now requires its account columns. Drain old workers before enabling the
new bulk task kinds. Roll out the admitted matching API/worker image with speech
disabled, then configure `OPENAI_API_KEY`, `SPEECH_ENABLED=true`, `TTS_VOICE` and
`SPEECH_PROVIDER_CONCURRENCY` identically. API startup publishes desired profiles;
mismatched workers refuse to send or publish old speech. Image-only updates do not
infer new variables or activate stored Doppler secrets.

Verify original-media storage and temporary artifact storage separately. Cloud
originals remain in the private durable bucket with no expiry; generated MP3 shares
the private artifact bucket's one-day `speech/` lifecycle, never the source bucket.
Confirm bucket policy/lifecycle through an authorized operator, not a broader runtime
key. Keep maintenance enabled for bounded candidate expiry and artifact removal.
Migration 019 originally starts both speech preferences off. The forward default
change below enables Read aloud only for accounts created after migration 021.

Then deploy the matching website and use a disposable account to verify opt-in,
candidate review/save, read aloud, cancellation, scoped Range playback and expiry.
Recovery must use the updated reconciliation script: it cancels speech tasks,
clears machine results and expires derived artifacts without deleting original
audio or accepted transcript history. See [speech contracts](speech.md). This is
an operator procedure, not evidence that production activation has occurred.

### Speech defaults (021)

Apply `20261023_021_speech_defaults` with the owner connection after 020 during the
normal migration window. It changes only the database default for future accounts:
transcription remains off and Read aloud starts on. Existing rows, saved choices,
preference versions and queued work are untouched. Do not update existing accounts
to simulate a default change, and do not edit historical migration 019.

Roll out the matching API/worker and website through the normal protected release.
Verify a disposable new account reports transcription off/Read aloud on, that it
can save Read aloud off, and that opening a note or the audio controls never
prepares/plays audio automatically. This source change does not authorize applying
the migration to a retained database or changing production preferences.

### Selectable speech voices (022)

Apply `20261024_022_speech_voices` with the owner connection after 021. It backfills
only the new Reed default, preserving consent flags/generations, and adds the
per-voice installation profile map. Both runtime processes now require this schema.

Drain old API/worker instances, install matching registry-aware binaries with
`MINIMAX_TTS_ENABLED=false`, and let API startup publish `speech-voices-v1` plus
the desired profile map. The protocol marker fences legacy single-voice workers;
legacy TTS receipts require starting again. Do not restart old API instances that
could republish the single-profile configuration. Verify Reed and transcription
before enabling `MINIMAX_TTS_ENABLED=true` on API and worker with the existing
server-only `MINIMAX_API_KEY` and temporary artifact storage. Keep `SPEECH_ENABLED`,
`OPENAI_API_KEY`, `TTS_VOICE` and `SPEECH_PROVIDER_CONCURRENCY` consistent too.

Deploy the matching website and verify remembered voices, explicit prepare/play,
switch cancellation, cache reuse, and scoped playback with synthetic notes. Provider
qualification and sample provenance are in the [voice evidence](design/screenshots/speech-voices/README.md).
Operational rollback disables MiniMax TTS while retaining the new schema/binaries:
saved choices remain visible as unavailable and Reed can be selected explicitly.
Use the current restore reconciliation script to preserve the remembered choice
without reviving generated audio. Production migration, provider activation and
deployment remain separate operator operations.

### Ask Grove tools rollout (020)

Apply `20261023_020_ask_tools` with the owner connection after the notebook lifecycle
schema, during the normal drained migration window. Coordinate the separately
reserved media migrations 017–019 against the final release source. The migration
retains old conversations and adds defaults, tool revisions, execution records and
provider spending counters. Runtime readiness requires the new conversation columns.

Configure optional `EXA_API_KEY` / `TAVILY_API_KEY` as API-only runtime secrets, plus
`RESEARCH_DAILY_CALL_LIMIT` and `RESEARCH_MONTHLY_BUDGET_USD`. Missing keys leave the
respective provider unavailable; they do not disable saved-note chat. Initial app
provisioning and Compose forward these settings only to the API. Existing image-only
rollouts preserve provider configuration, so add keys/limits through the operator
configuration procedure before testing. Never use public website variables for keys.

Roll out the admitted API/worker image before the website. Verify Exa-only,
Tavily-only, both-off, bounded research citations, notebook creation/filing and
version-fenced Apply/Undo with a disposable account. Use the current recovery
script: it preserves current tools and conservative spend, clears resumable external
calls and invalidates old write previews. See [Ask tools](ask-tools.md).

### Notebook lifecycle rollout (016)

Back up the database and pause/drain API and worker mutations. Apply
`20261023_016_notebook_lifecycle` with the owner connection after 015, then roll out
the admitted matching API/worker image by digest before the website. The additive
migration defaults existing notebooks to active, preserves authored records and
adds archive provenance and inactive-notebook write guards; DDL requires the normal
maintenance window. Runtime readiness requires the new project/note columns.

Verify subtree Archive/Restore and soft Delete using a disposable account, including
non-owner RLS denial, preserved source/history, stale-save rejection and revoked
direct links. Restore does not revive direct links; a live ancestor link can cover
restored descendants again. Use the current recovery reconciliation to replay
notebook/note tombstones. This is forward-only; do not run older mutating API/worker
versions after activation. See [notebook lifecycle](notebook-lifecycle.md).

### Notebook assistance rollout (015)

Apply `20261022_015_notebook_assistance` with the owner connection after 014 during
the migration window, then deploy the matching admitted API/worker image and website.
It preserves authored data and initializes four new preferences from existing choices.
Runtime readiness requires the new columns. Old workers must be drained before the
new assistance job kind is admitted. Verify a cited summary, a preview/Apply/Undo,
private export and visit baseline using a disposable account. Use the updated recovery
reconciliation to invalidate old previews and reset restored visit windows.
See [notebook assistance](notebook-assistance.md) for the data and lease contracts.

### Queue and retained-deletion rollout (014)

1. Back up the database; pause API/worker mutations and retain lifecycle webhooks.
2. Apply forward migration `20261022_014_queue_processing` with the owner connection,
   after013. It preserves source rows, adds tombstones/visibility policies and
   creates durable tasks, epoch fencing and atomic dispatch functions. Index/DDL
   locks require the maintenance window. Do not run old workers after the cutover.
3. Configure matching private export storage on API and workers using [jobs](jobs.md).
   DigitalOcean needs S3-compatible storage, not ephemeral local disks. Keep cloud
   exports disabled until the bucket/credentials/lifecycle and readiness are verified.
   Image-only deployments preserve existing provider settings; add these separately
   through the operator's configuration procedure.
4. Roll out the admitted API/worker image by digest, then the website. Verify real
   non-owner roles, retained-but-hidden records, public-link denial, queue fallback,
   export/download isolation and an incremental backfill. Drain v1 broker deliveries
   before disabling `WORKER_LEGACY_QUEUE`; allow40s worker shutdown grace.
5. Recovery must use the updated reconciliation script. It retains authored rows,
   replays tombstones and invalidates restored leases, exports and credentials.

This is a forward-only lifecycle/API change. The old synchronous account-export
route returns410; new clients use `/v1/exports` and `/v1/tasks`.

- Next.js website: **https://usegrove.cloud** on Vercel, production Clerk and an authenticated BFF.
- Hono API: **https://api.usegrove.cloud**, REST `/v1`, MCP `/mcp` on DigitalOcean App Platform.
- Worker: leased processing, organization, retention, account deletion, and transactional mail.
- Neon PostgreSQL 17 + pgvector 0.8.0: migrations and non-owner runtime roles.

Production is deployed in New York, near Neon's AWS US East 1 database.
One 1-vCPU/1-GB API and one matching worker cost **$20/month combined**, plus Neon
usage. Worker polling keeps the database active; do not budget it as mostly asleep.
The published Node 24 image runs both components. Compose remains available for
self-hosting with pgvector 0.8.2. See [delivery evidence](delivery.md).

API admission, interactive concurrency and per-process database pools are configurable.
See [capacity settings and verification](development/backend-capacity.md) before
changing connection counts or resource sizes.

`usegrove.one`, `usegrove.ca`, `grovenote.app` and the four `www` names redirect
with HTTP 308 to `usegrove.cloud`. Cloudflare hosts `usegrove.cloud` DNS; Porkbun
remains its registrar and hosts the other redirect domains. Vercel handles redirects.

Keep Cloudflare **Email Address Obfuscation** (`email_obfuscation`) **off** for
`usegrove.cloud`. Its HTML rewriting changes server-rendered contact-email text
before React hydration and causes error 418 on the legal pages. Public support
emails must remain ordinary, readable mail links. After changing edge settings,
review `/privacy` and `/terms` in a real browser and check for hydration errors;
local Next.js tests do not exercise Cloudflare transformations.

## Clerk

Grove application `app_3KtGcnwE2Yg0P34l9PVij7LnOTS` has separate development and
production instances. Production issuer: `https://clerk.usegrove.cloud`;
development issuer: `https://wanted-bison-3950.clerk.accounts.dev`.
Pull production keys with `clerk env pull --app app_3KtGcnwE2Yg0P34l9PVij7LnOTS
--instance prod --file /absolute/path/to/.env.clerk.production.local`.
Secrets belong in Grove's Doppler project, ignored 0600 files and the private
`secrets.md` custody inventory. Keep API, worker, website and operator configs
separate; updating custody does not deploy or rotate provider credentials. Never
commit the inventory or include values in plans or PRs. `usegrove.app` was a
provisional mistake and is no longer configured.

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
Apply forward migration `20261020_009_conversations` before deploying the
conversation-capable API/worker and website. It adds account-isolated conversation,
turn and deletion-tombstone tables; existing notes are unchanged. Back up before the
owner migration. Roll out API/worker before the website. Conversations use the
configured generation provider and existing account budgets; the website allows
180 seconds for a contextual reply. Retain conversation tombstones during recovery;
the reconciliation tool removes deleted chats and invalidates restored proposals.

Independent AI preferences require `20261022_013_ai_preferences` after 012.
Verify a backup and migration history, pause API/worker traffic, apply the forward
migration with the owner role, then deploy matching API/worker replicas before the
website. The migration preserves each account's legacy choices and retained notes,
adds independent controls and an Ask Grove cancellation version, and updates the
reindex function. Verify mixed enabled/disabled controls with the non-owner roles
before resuming traffic. Retain the additive schema and preference-aware API/worker
on rollback: older binaries only enforce the grouped organization/summary flags.
Restore reconciliation requires the same forward schema on authority and target.

Both use the same model configuration. Self-hosted local embeddings need a writable
model-cache path and use CPU inference. Remote role configuration, encrypted settings
and the Cloud DeepInfra/MiniMax defaults are documented in [models](models.md).
`EMBEDDING_MODE=disabled` explicitly selects lexical-only operation. A profile never
silently falls back to another provider or dimension.

Readiness waits for database-role checks and embedding initialization. Configure
at least 180 seconds of initial startup time for first model download. Health
responses contain no customer data. Reverse proxy access logs must omit bodies,
authorization headers and search queries; use POST search.

## Neon + DigitalOcean + Vercel

### Public sharing rollout

Before deploying a sharing-capable API/worker, apply the additive forward migration
`20261021_011_public_sharing` with the migration-owner role. Configure an independent
64-hex-character **`SHARE_LINK_KEY`** on the API only; all replicas must agree.
Compose and initial DigitalOcean provisioning support the optional secret. Existing
image-only rollouts preserve configuration, so install it explicitly in the API's
`SECRET`/`RUN_TIME` environment before rollout. Deploy the matching website last.

Without this key, sharing reports unavailable; the rest of Grove is usable and
owners can still revoke links. Key replacement does not revoke existing links;
replace/revoke links separately. Recovery revokes every restored link, including
its encrypted copy, before serving traffic. Rollback retains the additive schema.
See [sharing](sharing.md) for the key-backup and permission contract.

Timed-link rollout additionally requires `20261022_012_share_expiration`. Take and
verify the production backup, confirm only this forward migration is pending, apply
it as the migration owner, and verify retained share tokens/versions and tenant
policies. The additive migration preserves no-expiry links and enforces deadlines
inside the public SQL reader. Deploy matching API/worker replicas before the website;
keep this migration when rolling application code back. Do not repeat 010/011.

Redact capability segments in edge/proxy logs for `/s/*` and `/public/shares/*`.
Verify no-store/no-index/no-referrer headers, signed-out access, live edits, scope
narrowing and revoked-link reload/history on the actual Vercel/API hosts. Public
readers do not call Clerk or inference providers.
The October22 Vercel canary was visible in request-path logs; actual host-path
redaction remains unverified. Authentication providers are scoped to account and
workspace layouts so shared-reader success/error/404 pages do not load their SDK.

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
| `DEEPINFRA_API_KEY`, `MINIMAX_API_KEY`      | Server-only credentials for the Cloud inference roles            |
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
and inference/cursor keys are `SECRET`/`RUN_TIME` values. The API and worker receive only
their own database login. `DATABASE_SSL=require` verifies certificates. These
providers communicate over authenticated public TLS, not a shared private VPC.

The API uses readiness `/health/ready`, liveness `/health/live`, and a 180-second
startup allowance. Cloud inference uses remote providers; self-hosted local model
cache is writable but ephemeral. The worker uses the same image/configuration with
`node dist/worker.js`. App Platform edge caching is disabled for REST/MCP.

### Rollout and rollback

The release path is **feature PR → development → frozen release PR → production**.
Merge the Release Please PR into development, wait for source CI and the immutable
`vX.Y.Z` release, then dispatch **Select Release Candidate** on development with
that tag. It opens `promote/production/vX.Y.Z`, labelled and assigned to
`miniaxolotl`. Its tree/source/upstream/tooling and CI identity are frozen; later
development commits never enter that PR. Use merge commits for promotion.

Both core branches require strict GitHub Actions **CI Gate**, PR/conversation
protection and no bypass. Production permits merge commits only. Release tags and
frozen refs reject updates/deletion. Auto-merge may wait for these requirements.
Candidate selection is operator-triggered; ordinary pushes never authorize it.
Bot-created PRs receive explicit CI dispatch using `GITHUB_TOKEN`. Promotion CI
also verifies the operator-triggered workflow's candidate artifact. Records expire
after 90 days; rerun the original selection run to refresh its evidence.

GitHub secret `DIGITALOCEAN_ACCESS_TOKEN` and variable `DIGITALOCEAN_APP_ID` are set
on `miniaxolotl/grove`. **Deploy** admits only production and waits for independent
full CI before resolving the tag's source SHA/tree separately from the production
merge SHA. Missing DigitalOcean configuration fails before publication. It checks
every npm tarball, publishes coordinated packages and immutable images, then rolls
both API/worker components to the verified digest and checks readiness.
Development runs validation and Release Please only. Vercel's production branch is
production; preview deployments are disabled and its ignore command skips all other
refs. Existing preview resources are retained pending a separate retirement choice.
Database migrations remain an explicit owner-credential operation before rollout;
check the applied migration history before promotion rather than repeating a
migration from an earlier rollout.

The nested-notebook feature requires forward migration
`20261020_008_nested_notebooks` before deploying its API. It adds nullable parent
references and revision counters to existing projects, with same-account foreign
keys. Existing notebooks begin at the top level, and existing notes/grants are
unchanged. Apply with the migration owner, then roll out the matching API/worker
before the website. Older clients may omit `parentId` and `expectedVersion`; a
legacy rename preserves nesting. The migration does not require data backfill or
provider reindexing, and is not automatically rolled back.

For the one-command Cloud onboarding release, apply `20261019_004_connection_setup`
before updating the API, then deploy the approval website, publish updated CLI/native
packages and verify the install commands. The website and npm release must be
coordinated because older CLIs do not expose `connect`. See the detailed
[onboarding rollout](cloud-onboarding.md#rollout).

Existing-app updates preserve provider-encrypted secrets, domains and sizing:

```sh
node --env-file=.env.digitalocean.local scripts/deploy-digitalocean.mjs \
  --app-id 3aef47f9-3724-4f21-9cad-8c4eb5644af0 \
  --digest sha256:YOUR_PUBLISHED_DIGEST --propose
# Repeat without --propose and with --wait to deploy.
```

Rollback uses the same command with a previously healthy digest after confirming
current schema, runtime configuration and lifecycle/queue compatibility. Select a
verified last-good deployment for the current environment; an old bootstrap image
is not a default rollback target. Forward migrations are not automatically reversed.
This remains an explicit operator recovery, not an automatic rollback controller.

Update website variables in Vercel's **production** environment and redeploy:
`SITE_URL=https://usegrove.cloud`, `GROVE_API_URL=https://api.usegrove.cloud`,
the production Clerk keys, and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` /
`NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`. Public keys are included at build time.
Private `/app` pages and BFF replies are uncached and omitted from indexing;
analytics are mounted only in marketing.

For manual Vercel deployments, build/upload a clean `git archive` snapshot of the
promoted `production` commit rather than the operator worktree, which contains
ignored private artifacts. Retrieve
production environment only into that private staging directory. Deploy the API
and worker first when website contracts change. Queue, retention, and Resend setup
are documented in [background services](background-services.md).

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
   memory/account/notebook tombstones, identity state and session revocations,
   hides retained dependent content, clears cached mutation results, cancels old
   jobs/downloads and invalidates **all** old
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
Because the CLI and shared libraries are bundled into multiple artifacts,
Release Please uses one root version/changelog and updates all five package,
native plugin and marketplace versions together, including shared-only changes.
Both `feat` and `feature` are recognized. The first coordinated release is 1.2.0;
the root 1.1.0 ledger establishes its migration baseline without republishing old
components. Historical component changelogs and tags remain historical evidence.
Publication to npm is on the `production` branch through `scripts/publish.mjs`,
after build/type/artifact checks. CI also
checks PostgreSQL/RLS, HTTP/MCP, website and image build on pull requests.
The publisher preflights all tarballs against registry integrity before the first
upload, rejecting changed contents under an existing version. Every package must
declare the GitHub repository used by npm provenance. After each upload, integrity
readback allows 60 attempts five seconds apart for asynchronous npm processing;
conflicting bytes and provider errors fail immediately. Use
`node scripts/publish.mjs --dry-run` to check the release without publishing.
`scripts/release/pack.mjs` canonicalizes the resolved package manifest before final
packing, because pnpm's asynchronous workspace-range resolution can reorder keys.
Consumer artifact tests exercise these exact final tarballs. Retry still requires
byte-for-byte registry integrity; metadata ordering never excuses a mismatch.
Extraction preserves archive permissions, making retries independent of the
operator's umask as well as the runner's.

The PostgreSQL migration release is tracked in
[PR #4](https://github.com/miniaxolotl/grove/pull/4): CLI and OpenCode **0.5.0**,
with the new server, Claude and Codex packages at **1.0.0**. Native manifests and
marketplace pins match their npm package versions. The one-time `release-as`
overrides were retired with the explicit version updates. The new single-root
release configuration uses root-relative explicit JSON updaters for every pin.

Review versions and marketplace pins, require green release PR checks, then merge
into `development` to create GitHub releases. Promote that release to `production`
to publish npm artifacts and versioned container images. Verify registry versions,
integrity and installation after publication. Package publication and live data
migration are separate rollout steps.

For a failed publication, rerun Deploy on the same current production commit.
Identical registry artifacts and immutable source images are reused; conflicting
bytes fail and require a new version. Do not overwrite versions or silently move
a frozen head. Reconcile target divergence into development and select a new
release. Local image helpers build only `grove:local`; public pushes use Deploy.
