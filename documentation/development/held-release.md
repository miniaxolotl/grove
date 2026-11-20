# Held lifecycle runtime

This contract separates compatible startup, signed lifecycle acceptance, remote
reconciliation and general effect release. It is not an authorization to deploy,
change provider settings, apply schema, publish or send. Follow the protected
[release path](../release-conventions.md) and [rollout prerequisites](../deploy.md).

## Explicit controls

An image built with `GROVE_HELD_RELEASE_BUILD=true` requires exactly one control:

- `GROVE_RELEASE_HOLD`: strict schema-1 source, production, product tag,
  publication run/attempt, immutable image digest and publication receipt identity.
  Both processes expose held liveness and a serialized nonce-bound schema probe;
  all general API/MCP routes and public readiness return 503.
- `GROVE_RELEASE_RECONCILE`: `{schema:1,identity,receipt}`. The identity is the
  same held identity; `receipt` binds the explicit lifecycle phase. Startup checks
  a persisted owner-installed `lifecycle_release_control` admission. API processes
  expose only the two exact signed lifecycle POST routes below. Worker processes
  initialize only the existing database, broker and narrow billing reconciler.
- `GROVE_RELEASE_APPROVAL`: `{schema:1,identity,approval}`. A syntactically valid
  receipt hash does not release effects. Startup must atomically consume the exact
  persisted owner-approved handoff before entering the ordinary runtime. This does
  **not** open general API routes or readiness: a separate owner-only persisted
  public approval must match the current generation and actual evidence.

Controls are mutually exclusive and source/product-version checked on every
restart. Missing controls fail closed in a held image. Product version is distinct
from a separately preserved API package version. HTTP cannot unlock a process.
Private runtime database URLs require the separate `grove_api`/`grove_jobs` roles,
`sslmode=verify-full` and `DATABASE_SSL=require`; owner or bypass roles are rejected.
These inputs require explicit source/operator review; do not toggle them manually
as a substitute for admitted source, custody, provider-state and approval evidence.

## Signed acceptance

Only `POST /v1/webhooks/clerk` and `POST /v1/webhooks/stripe` are eligible. Query
aliases, trailing paths and other methods are not webhook ingress. Bodies are
limited to 256 KiB and five seconds, signature headers to 4 KiB, and concurrent
acceptance to 16 requests. Signatures use the configured Svix/Stripe verifiers;
Stripe mode must match the configured key. Unsupported or malformed lifecycle
events and invalid signatures are rejected.

The handler retains only provider event identity, type, time and body fingerprint,
plus scoped durable task IDs/versions. Raw bodies, addresses, metadata and keys
are not staged or queued. Stripe tenant identity is resolved from the existing
customer mapping, never event metadata. Unknown mappings fail without an ACK.
Identity deletion is irreversible; disabled authority wins equal-time conflicts.

202 means the authority and work record committed atomically, **not** that remote
reconciliation finished. Identical delivery is idempotent; conflicting replay is
rejected. A lost ACK can be redelivered without duplicating work.

## Narrow work and handoff

The forward lifecycle migration reuses `background_tasks` and `JobBroker`, not a
second queue. Broker messages contain only `{kind:"task",id}`. Confirmed publication,
reserved dispatch tokens and database redispatch survive lost publication and
broker disconnection. Narrow tasks are excluded from ordinary task claims.

Work has per-customer generation fencing, one live lease per customer, up to eight
global leases, five attempts, a 23-hour intake deadline, 120-second leases, bounded
backoff and a 50-second processing deadline. Provider calls have five-second
timeouts. Reads are limited to ten 100-item pages per resource; partial, foreign,
duplicate or oversized results cannot produce a completed receipt.

No SQL transaction spans Stripe I/O. Each call and result commit rechecks scope,
lease, generation, authority and customer mapping. Deleting accounts cannot regain
entitlement. Cancellation/checkout expiry commits an uncertain effect marker
**before** remote I/O. Stripe's SDK can retry a closed connection even with retries
disabled; the narrow supported fetch adapter also forbids repeated effect paths
and redirects. Recovery reads canonical provider state. An ongoing or missing
readback remains uncertain; it never permits blind cancellation replay.
Each client permits at most 10,000 distinct effect paths; reaching the bound fails
closed rather than discarding replay protection.

Completed work persists scoped remote evidence and its authority generation.
Handoff requires every mapped customer to have current matching evidence and no
unresolved current work or uncertain effects. Owner-only handoff stores that
evidence with the approved generation and receipt hash. A new unique lifecycle
event invalidates handoff; an identical retry does not. Startup rechecks the
evidence and generation atomically. That commit is the release point; subsequent
ordinary work must continue to honor account deletion and durable reconciliation.

Normal signed Clerk/Stripe routes use the same durable acceptance path after
release. Account deletion commits authority before its billing work intent;
cleanup waits for actual canonical cancellation/expiry readback. Ordinary workers
continue these tasks on the existing bulk pool, broker and PostgreSQL fallback.
Checkout, portal and interactive status synchronization are unchanged.

Entitlement requires exactly one item with quantity 1. Expanded products are
supported; multi-item, multi-quantity and missing-quantity snapshots store
`unsupported`/null eligibility. Partial or malformed snapshots cannot complete
reconciliation. Canonical reads upsert subscriptions and mark removed ones
canceled, without deleting history or trial consumption/linkage. Disabled or
deleted accounts cannot regain Pro from retained subscriptions.

Evidence is refreshed durably when stale or its source/customer/authority changes.
Failed tasks do not silently reset: authenticated owners can inspect
`GET /v1/billing/reconciliation` and request scoped recovery with
`POST /v1/billing/reconciliation/:id/retry`, body `{operationId:<UUID>}`.
Recovery preserves failed evidence and uncertain effects and is operation-idempotent.
Deleting accounts remain held for operator/worker recovery rather than regaining
interactive access. Bounded retention redacts raw event IDs after 30 days and
confirmed effect IDs only after completed work; replay/target hashes remain.
Privacy cleanup redacts scoped staging IDs only after deletion and reconciliation.
Neither path clears uncertain acceptance or billing history to make a check pass.

## Publication and continuation

No held release is selected by this change. An optional reviewed source-only
`scripts/release/held-decision.json` selects `held-publication-only`, exact app,
previous image digest and preceding source `anchor`. Its declaration commit may
change only that file. The following coordinated Release Please stamp is verified
with the shared stamp checker and patch-first release-intent policy; extra source
edits, floating heads and mixed selected/held declarations are rejected.

Source Release discovers both the declaration push and its direct version-stamp
push through those same strict validators. Production admission still requires
the explicit stamped-source validation. A code/docs repair retires any previous
source-bound declaration; after it merges, a separate declaration-only PR must
anchor the newly accepted source before its next coordinated patch release.

Protected Deploy persists `publication_pending` **before** image/package writes,
then verifies every package integrity, both image registries and the actual held
image metadata/entrypoints. Only then does it emit `published_held`. Ordinary
deployment, generic delivery receipts and website jobs are excluded. Failed runs
resume only through trusted, unexpired pre-write artifacts, exact run/attempt
provenance and a bounded linked custody chain. Missing publication is not success;
an uncertain prior provider request is never replay permission.

The receipt chain is:
`published_held → held_verified → lifecycle_verified → effects_approved → runtime_verified → public_verified → website_verified`.
Protected **Held release continuation** records actual named-instance proofs for
each stage. Its final stage uses the existing Vercel helper to pull configuration,
write exact source identity, build afresh, deploy and verify the live identity;
it cannot reuse a stale site artifact or call publication-only delivery complete.

The local `scripts/release/held-operator-cli.mjs` composes the independently
qualified operator's private-file, manifest, transaction and fsynced journal
interfaces. It does not implement another backup, migration or secret store.
Its default is help, not execution. `plan`, `execute` and readback-only `reconcile`
require an explicit independent directory and private request. The retained
`FROZEN_V11129_COMPOSITION_BLOCKED` manifest is rejected **before secret loading**;
no command/approval flag overrides it. A new source requires independent
`source-bound-held-release-v1` execution qualification, fresh backup/restore and
custody under the owner's separate contract.

The parameterized replacement is owned in
[`ops/held-operator`](../../ops/held-operator/README.md). Its private installation
verifies the immutable commit/tree/files, running code and installed dependency
sources, actual fixture preservation/backup artifacts and an independent signed
review. No production review key or admission is shipped. Fixture scope never
admits execution; production review is still separate from fresh live custody
and readiness. Qualification requests include source, publication, command,
action and `consume`: writes consume exactly once, while reconciliation verifies
existing consumption without writing. The migration entry point reuses the same
bounded 045–048 barrier and refuses fixture custody for a production operation.
The replacement implements existing-only SQLite WAL/FULL consumption/CAS and one
pinned app authority shared by registered source/code/custody installations.
Provider, migration, backup and owner SQL paths use the same app window; SQL and
provider intents survive crashes/expiry. Readback never clears quarantine; explicit
authority-only resolution requires canonical persisted evidence and renewed signed
dashboard/controller exclusion. No closure/public-key/app-authority pin or live
exclusion is shipped. Missing independent installation and live facts still block.
GET plus PUT is not an atomic DigitalOcean generation fence; no unsupported CAS
header is sent. Operational code and the admitted app source have separately
verified closures and need not be the same Git revision.

Requests reference trusted publication/previous workflow run/attempt coordinates,
a private journal directory, independent backup receipt/journal/ciphertext paths
and an exact sanitized owner command. Retained ciphertext and the confirmed
restore journal must match the command's custody hash, source and manifest;
fixture receipts, torn journals and overdue original-custody reviews are rejected.
Initial restore additionally reuses independent hosted observation and
`validateCustody` before changing provider state. Commands bind
source, publication, parent receipt, action, manifest, expected/proposed hashes,
backup custody hash, UUID and at most five minutes of write validity. Expired
commands permit only exact readback reconciliation, never another write.
Restore/reconcile/lifecycle-ingress/
effects/public-health proposals preserve unrelated provider configuration and fence
the exact generation and instance inventory. Intent is fsynced before PUT/SQL;
unknown acceptance stays uncertain and permits **readback only**, not another PUT.
The innermost CLI dispatch retains the outer approved complete raw inventory;
pagination, invalid totals and any metadata/identity drift veto the write rather
than establishing a new inner baseline. Explicit resolution changes only the
authority after readback, never repeats the unknown provider/SQL effect.
An already exact-active target is verified without a write. Database operations
are short bounded owner transactions, with no remote I/O inside them.

Private lifecycle/runtime proofs require a source/role/path/nonce-bound HMAC using
the existing `CURSOR_SECRET`. The fixed console command computes it remotely;
the secret never enters argv or returned evidence. Proofs include persisted phase,
approval and public hashes. Runtime proofs additionally require real API readiness
or initialized ordinary worker runtime. Operator command hashes are distinct from
later workflow receipt hashes, avoiding circular approval identities.

## Rollout limits and verification

The migration installs **no** release admission or approval row. Its new registry
requires fresh source freeze, byte comparison, populated restore rehearsal and
actual runtime-role qualification. Prior migration/image proof is not inherited.
Provider ingress must not be opened until the source-bound narrow API and worker
have been privately verified under the explicit operator phase and backlog custody.

Live qualification remains separate: new immutable source/tag and registry freeze,
populated 048 rehearsal, independently qualified operator manifest and original
ciphertext/backup/restore custody, actual provider-console transport, signed
backlog routing, explicit outage/effect/public approvals and actual fresh website
delivery. No active declaration, deployment, publication, migration or live send is
performed by these source changes. Checkout/portal/status transaction I/O remains
a separate existing gap; the narrow reconciler does not claim to repair it.

Workflow-matrix tests also verify exact tagged promotion wrappers: source tag,
tree, ancestry and frozen/final merge parents must match before resolving the
strict released-held source. This normalization is test-only, not publication
admission or permission to inherit a declaration onto later source edits.

Focused verification lives in `tests/src/lifecycle-{ingress,storage,handoff}.test.ts`
and `tests/src/release-hold.test.ts`: real disposable PostgreSQL/broker, signed
ingress, authenticated loopback provider faults, transaction-boundary assertions,
replay, stale leases, remapping/deletion races, uncertain acceptance, restart and
handoff invalidation. `tests/src/held-operator.test.ts` checks the owner transition
composition against real PostgreSQL; `scripts/release/held-*.test.mjs` cover
publication custody, proposals, proofs, journal faults and workflow exclusions.
These fixtures do not qualify live Stripe/Clerk, DigitalOcean
console transport, production TLS credentials, outage duration or public readiness.
