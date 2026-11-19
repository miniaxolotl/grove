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
  persisted owner-approved handoff before entering the ordinary runtime.

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

## Rollout limits and verification

The migration installs **no** release admission or approval row. Its new registry
requires fresh source freeze, byte comparison, populated restore rehearsal and
actual runtime-role qualification. Prior migration/image proof is not inherited.
Provider ingress must not be opened until the source-bound narrow API and worker
have been privately verified under the explicit operator phase and backlog custody.

Current composition gaps remain release blockers: ordinary billing webhook and
deletion paths still use their previous synchronous implementation; normal-worker
continuation, evidence refresh/retention and the publication/resume/approval/site
workflow composition are not yet complete. Checkout, portal and status transaction
I/O is a separately retained gap, not repaired by the narrow runtime. Do not release
general effects or treat this source checkpoint as an admitted release.

Focused verification lives in `tests/src/lifecycle-{ingress,storage,handoff}.test.ts`
and `tests/src/release-hold.test.ts`: real disposable PostgreSQL/broker, signed
ingress, authenticated loopback provider faults, transaction-boundary assertions,
replay, stale leases, remapping/deletion races, uncertain acceptance, restart and
handoff invalidation. These fixtures do not qualify live Stripe/Clerk, DigitalOcean
console transport, production TLS credentials, outage duration or public readiness.
