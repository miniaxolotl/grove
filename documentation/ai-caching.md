# AI work caching

Grove reuses exact AI work to avoid **paid external provider requests**. Internal
database reads still run: a cached embedding is not a cached permission decision,
note listing or authorization grant. No additional cache service is required.

## Usage stays separate

Recall/search, Ask replies, organization and assistance retain their existing
independent Free/Pro allowances. **There is no pooled credit wallet, exchange rate,
subscription-price change or new billing activation.**

- A distinct fully cached metered request uses **0.2 actions** from its own allowance.
- A fresh or partly cached request uses **1 action**. A hit for one internal step
  does not make an otherwise fresh answer a fully cached request.
- Reopening, polling or replaying the same completed operation does not charge again.
  Existing ready summary/assistance reads remain reads, not newly charged actions.
- Failed, stopped, unauthorized or source-stale operations release their user-action
  reservation. Actual and uncertain provider-attempt evidence is retained.
- Writing, ordinary reading, keyword-only search and export keep their existing
  behavior. Speech keeps its separate duration-based accounting and content cache.

Internally, one action is five integer units; cached usage is one unit. Admission
and settlement never add floating-point fractions. A request can start with a
discounted provisional reservation, but must atomically obtain the remaining units
**before** sending paid work. Thus 0.2 remaining permits a valid cache hit, not a
fresh provider call. Historical actions keep five units each. Quotas never pool.

Usage responses retain existing limit fields and add optional per-feature
`cache: {fresh, cached}` request counts. Metered results can include a `usage`
receipt with `feature`, `status` (`fresh`, `cached`, `mixed`) and `actions`. A null
charge means that plan metering is not applicable, not a fictional provider refund.
Conversation receipts retain the original request charge on reopen/replay.

Settings → Billing shows weighted usage and fresh/cached counts. Cached-action
savings are `cached requests × 0.8`; these are allowance savings, **not dollars**.
Ask and search show request provenance without exposing cache keys or private input.

## Reusable work

| Feature | Exact identity | Retention |
| --- | --- | --- |
| Query embedding | Account, effective text, purpose, embedding profile/model and dimensions | 24 hours |
| Note embedding | Account, text, document purpose and embedding configuration | 7 days |
| Title/tags | Account, source text/attributes and generation prompt/profile | 7 days |
| Classification | Account, source attributes/notebook, decision profile and exact candidate versions | 7 days |
| Planning | Account, exact question/history/scope, tools/preferences, source generation and model/prompt version | 30 minutes |
| Read-only answer | Account, exact question/context, current source snapshot/versions, settings, prompt/model and web evidence | 5 minutes |
| Research search | Account, provider configuration, exact query and request settings | 5 minutes; 1 minute for explicitly time-sensitive queries |
| Page extraction | Account, provider configuration and exact requested URL set | 15 minutes |

These are maximum retention periods, not permission to use invalid evidence. Hits
do not extend expiry. Search and extraction remain different operations/providers.
Partial or failed research does not become a complete cached result. Original web
retrieval times are preserved. No AI call is made merely to classify cache similarity.

Metadata-only revisions can rematerialize embeddings and enrichment at the current
note version without inference. Classification also checks its candidate revisions
before publication. Content/configuration changes require the appropriate new work.
Enrichment cache publication itself rechecks the job lease, note revision and current
preferences transactionally. A deleted job or disable/re-enable during inference
cannot leave behind a reusable artifact from that invalidated operation.
Existing edit coalescing and affected-subtree notebook summary reuse are preserved;
self-hosted/flag-off processing is not given a new Cloud-only debounce delay.

## Refresh and source safety

**Refresh sources** submits a new read request with `refreshSources: true`. It
bypasses the relevant answer/research result once, using the turn ID as its refresh
identity. Transport retry/reopen of that completed turn is still free. Later
ordinary requests can use the explicitly refreshed evidence. Reusable query
embeddings and valid planning do not need another paid call just to refresh sources.
The composer retains any unrelated draft while refresh runs.

Every request rechecks current authority and current sources, including after
waiting or computing. Changed versions, moves, deletion, archive, expiry, revoked
grants/sessions, changed preferences and model-generation cutovers cannot authorize
an old cached answer. Read-only stored replies with invalid supporting notes/web
evidence become refreshable stale responses. Authored notes and original stored
conversation history remain retained. Workspace snapshots also remove derived
claims immediately after relevant source changes/expiry.

Generated create/edit/merge/organize/lifecycle previews are **not answer-cached**.
Planning reuse is not write authorization. Apply/Undo retain current permission,
version and explicit-review checks; cached data never automatically executes a write.

## Storage, concurrency and outages

Forward migration `20261025_029_ai_cache` adds tenant-isolated `ai_cache` and
`ai_provider_backoff`, plus weighted units on the existing action ledger and the
conversation refresh marker. Both cache tables force RLS for API/worker roles.
Only canonical input digests and validated outputs are stored; credentials are not.

Short database claims coalesce identical work across API/worker replicas. Inference
does not hold a cache transaction or connection. Leases last 120 seconds and renew
every 30 seconds; tokens, current account state and processing epoch fence late
owners. One cancelled follower cannot cancel a different owner. Exactly-once paid
execution across a crash after dispatch is **not** promised.

Account cache storage is bounded to 512 entries and 32 MiB of serialized JSON values,
with a 240 KiB application value limit. These are application bounds, not PostgreSQL
on-disk byte guarantees. Eviction does not remove a live owner. Retention/account
cleanup removes scratch data in bounded batches. Restore/model reset clears cache
and outage state and fences prior processing generations.

Recognized model transport/authentication/rate-limit/timeout failures open a short
10-second **account/provider-configuration** cooldown. A recovering configuration
admits one half-open probe across replicas. Still-valid hits remain available.
Input/schema errors, quota denial and caller cancellation do not open an outage
cooldown. This is not an installation-global provider-health circuit breaker or
an implementation of provider-specific Retry-After scheduling.

## Observability and boundaries

Allowlisted `ai_cache` events contain feature, fresh/cached/coalesced outcome,
requests avoided and end-to-end latency. Questions, note bodies, URLs, account IDs,
credential material and cache fingerprints are excluded. Group hit rates and
avoided requests by feature; compare successful cold/repeated synthetic runs.

Allowance savings are calculated separately from provider spending. The existing
[cost report](development/tier-costs.md) gives dated rate arithmetic, not observed
invoices or guaranteed cache dollar savings. No paid traffic is needed for tests.
Provider prompt caching may reduce repeated token cost but still sends a request;
it is not an application hit or a reason to award the cached action rate.

There is no semantic answer matching. Generic connector checkpoints/idempotent
imports remain unchanged: this checkout has no concrete conditional-read connector
to qualify. Future adapters must explicitly support account/configuration-scoped
TTL/ETag/Last-Modified behavior. A 304 saves bytes, not an external request; never
cache or replay connector writes.
