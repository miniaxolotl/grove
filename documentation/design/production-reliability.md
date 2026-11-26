# Production reliability: retrieval, freshness and recovery

**Proposed implementation, not shipped behavior.** This design closes gaps found
in the 26 November 2026 production smoke test of v1.11.37, source
`622ca2b0b5b98801c21166be9d00965f72bfe42d`. It does not authorize implementation,
live provider calls, data changes, deployment or broader connection permissions.
Current contracts remain in [search](../search.md), [workspace reads and
mutations](../development/client-cache.md) and [agent installation](../client.md).

The independent [UI/UX review #346](https://github.com/miniaxolotl/grove/pull/346)
owns broader navigation, controls and layout proposals. Coordinate shared surfaces;
do not fold that redesign into these fixes or claim its fixtures prove live behavior.

## Evidence and diagnostic boundaries

| Gap                     | Observed                                                                                                                                                                | Established boundary / remaining diagnosis                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic retrieval      | Hybrid requests returned `searchMode: lexical`; a meaning-only query missed a synthetic note even after indexing/enrichment were ready.                                 | `queryEmbedding` failures are caught by the list path. The query provider has an 850ms timeout. Provider latency, cache/backoff, quota and profile mismatch are hypotheses, not confirmed causes. |
| External-edit freshness | An open editor still showed the previous text and Saved until reload after an agent edit.                                                                               | A visible-workspace 60s refresh already exists. The observation did not measure an entire interval; first distinguish expected staleness from missing observation/reconciliation.                 |
| Draft durability        | Failed offline save retained text in the mounted tab; a hard navigation lost the unsaved draft. Controlled online retry created one note.                               | The cause of the first navigation is unknown. Memory-only drafts and unload protection are deliberate current behavior, not encrypted durable recovery.                                           |
| Legacy connection       | The old API origin was reachable, but discovery advertised a different resource/new issuer; old credentials bound the previous issuer. The client reported unreachable. | The packaged SDK correctly refuses the resource mismatch. Canonical reconnect with human consent worked; automatic migration or weakened OAuth validation is not a fix.                           |

Passing invariants must remain: exact reviewed passage edits, version conflicts,
idempotent creation, scoped Personal denial, revision comparisons, modal return
focus and keyword search. The [synthetic production revision comparison](screenshots/structured-documents/README.md#production-smoke-baseline--26-november-2026)
illustrates one preserved invariant, **not** a failure reproduction or an after-fix image.
No private account/note identifiers, credentials or raw production logs belong here.

## Ownership and implementation slices

Use one scoped implementation PR per row, in this order. Each slice adds its
failing regression before the smallest fix, updates its owning guide and records
exact-head evidence. S4's privacy decision can proceed while earlier slices ship;
it does not block the connection and retrieval fixes.

| Slice                                  | Main source owners                                                                                                                                                | Exit gate                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S0: reproducible diagnosis             | `lib/memory/src/{index,processing,ai-cache}.ts`, `lib/ai/src/index.ts`, `lib/integration-core/src/{index,node}.ts`, `packages/website/src/lib/workspace-cache.ts` | Deterministic failing cases and sanitized stage/outcome evidence identify the failing boundary; no speculative provider/configuration change. |
| S1: connection recovery                | Shared integration core; `packages/mcp/src/{connect,doctor,cli}.ts`; packaged agent consumers                                                                     | Old resource/issuer mismatch has a precise actionable error; explicit canonical reconnect works without moving old tokens or widening grants. |
| S2: retrieval and truthful degradation | Memory/AI/cache/action accounting; shared response contracts; search and Settings surfaces                                                                        | Successful cold/warm semantic retrieval and correct scoped fallback, receipts and status are demonstrated separately.                         |
| S3: editor freshness                   | `packages/website/src/lib/workspace-cache.ts`, dashboard `workspace-cache.tsx`, `memory-editor.tsx`, note readers                                                 | A visible clean note adopts an external commit without reload within the defined budget; dirty/uncertain drafts never rebase silently.        |
| S4: opt-in draft recovery              | Dashboard `note-drafts.tsx`, editor/session ownership, account settings and browser storage adapter                                                               | Approved privacy design, crash/reload recovery and erasure/replay races pass without treating local persistence as a server save.             |

The slices use existing shared packages. Do not add another backend queue/database
service, cross-project service, global cache or project-local credential store.

## S0: reproduce and measure before repairing

- Correlate a synthetic request across admission, embedding cache/lease, provider,
  vector validation, authorized candidate selection and action settlement. Record
  stage, bounded duration and allowlisted outcome only: no query/note text, token,
  URL query, account identifier or cache fingerprint in telemetry.
- Reproduce query timeout, provider rejection, malformed/dimension-mismatched
  vector, cache cooldown, exhausted allowance and unavailable current-profile
  document vectors independently. A document's indexing status does not prove that
  query embedding worked. Test cold and exact-cache-hit paths separately.
- For freshness, mutate through an independent authenticated API client while the
  browser is visible and untouched. Observe beyond the existing 60s interval,
  instrument active note subscriptions and cache versions, then test focus and
  reconnect. Browser automation must not insert an unnoticed reload or discard prompt.
- For drafts, test a normal same-tab network recovery separately from hard reload,
  tab/process crash, session refresh and terminal sign-out. Use a disposable
  browser profile; never enable persistent private data on the owner's profile
  just to obtain evidence.

## S1: safe canonical connection recovery

1. Classify resource/issuer mismatch at the OAuth discovery boundary using the
   SDK's typed failures or explicit validated metadata comparison, not arbitrary
   provider-message substring matching. Distinguish transport/TLS failure,
   deadline, expired sign-in, pending grant and incompatible resource/issuer.
2. Preserve the classification through `ApiClient`, bridge tool errors and
   doctor's allowlist. Show one next action: run the supported canonical
   `grove connect <agent>` flow, then test effective scope from the actual host.
   Keep `hostVerified: false` for CLI-only probes.
3. Recognize only the product's reviewed legacy-to-canonical Cloud mapping when
   offering migration. Discovery must not redirect credentials to arbitrary
   hosts. Respect explicit self-hosted origins and origin/agent/account binding.
4. Require browser sign-in/consent and separate Grove note-access approval. Reuse
   already-approved compatible grants without widening them. A new client stays
   pending until the owner approves; it does not inherit an old client's access.
5. Preserve old credential files, other agent selections, opt-outs and existing
   connections. Do not revoke the old connection or remove its credentials as a
   side effect. Interrupted consent/callback/grant completion remains resumable.

Test direct bridge tools and native OpenCode activation, not only a separate CLI.
Shared integration changes must release all bundled consumers together. Update
[client setup](../client.md) and [Cloud onboarding](../cloud-onboarding.md) with
the final codes, supported reconnect and cancellation/rollback instructions.

## S2: restore semantic retrieval without hiding fallback

1. Fix the measured failure only. If the 850ms query deadline is insufficient,
   measure cold/warm provider latency and interactive capacity before proposing
   a bounded revised deadline; do not simply increase every timeout. Check API
   and worker profile/model/dimensions/prefix identity before considering backfill.
2. Keep short interactive search bounded under its existing admission/deadline.
   If provider work cannot fit that budget, commit scoped durable work and expose
   pending status using the existing PostgreSQL/RabbitMQ workers. Never finish
   inference in a detached request promise or use browser polling as job execution.
   Existing [cache leases](../ai-caching.md) are not a second durable job system.
3. Keep `searchMode` backward-compatible and authoritative. Propose an optional,
   allowlisted retrieval diagnostic describing requested mode, executed mode and
   degradation reason. Older clients can ignore it. Intentional keyword mode,
   provider failure, quota denial, warming and indexing coverage must not collapse
   into an invented semantic success. Suggested diagnostic classes are timeout,
   unavailable provider, cooldown, quota, profile mismatch and pending coverage;
   freeze the enum/schema in S2 tests. Do not expose provider secrets or raw errors.
4. Keep lexical matching usable through failure. Preserve ranking tiers, scope/RLS,
   current-profile filtering, cursor binding and stale-search handling. Recovery
   must restart a degraded traversal explicitly, never change its ranking midway.
5. Audit fallback action settlement against [AI caching](../ai-caching.md) and
   [billing](../billing.md): failed semantic work must not be reported as successful
   semantic work; keyword-only search remains available. Regression tests must
   reconcile action reservations and retained actual/uncertain provider attempts.
   Resolve any ambiguous charging policy before changing it; no prices, allowance
   sizes, billing activation or fictional provider refunds are part of this repair.
6. Keep `/health/ready` as dependency/configuration readiness. Report recent
   observed retrieval degradation separately; do not run paid canary inference on
   health reads. Search gives reserved-space keyword fallback feedback; Settings
   distinguishes configured capability from observed/request-specific success.

Background repair/backfill uses existing opaque work IDs, current-scope/lifecycle
checks, fenced leases, bounded attempts/backoff and shutdown drain. No SQL
transaction spans provider I/O. An outage or retry cannot reintroduce deleted
evidence. Reindexing or provider changes need separate operator approval; retain
old vectors/provider evidence until normal forward migration and retirement rules allow cleanup.

## S3: bounded, draft-safe external-edit freshness

- First repair the existing observer → fetch → version merge → editor snapshot
  path. Same-browser metadata broadcasts cannot detect another device or agent;
  they supplement, not replace, server revalidation.
- Initial acceptance budget: at most **65s from an independent commit** to adopting
  a clean visible note on the qualified healthy test network; after becoming stale,
  focus/reconnect must reconcile within **5s**. Record actual request latency and
  timer delay. A failure/deadline becomes visible stale/retry status, never Saved
  as a claim of current freshness. Hidden tabs may pause but must reconcile on return.
- Reuse the cache's single visible-workspace scheduler and shared note query.
  Deduplicate processing polls, focus, reconnect and list/detail consumers. Do not
  introduce a timer per editor, blanket faster polling, full-page reload or a new
  real-time service without capacity evidence and a separate design decision.
- Clean notes adopt only higher authoritative content versions. Equal-version
  enrichment may refresh separately. Dirty, saving or uncertain notes keep source,
  base/version, cursor, Undo and original operation identity; show a reviewable
  newer-version notice instead. Never advance their save base behind the user's back.
- Fence late/older reads, account/session changes, 403/404 and deletion. Update
  affected mounted rows only; preserve order, filters, selection, focus, scroll,
  modal return context and reserved feedback space. No repeating toast stream.

If the current 60s path already meets this matrix, close the regression hypothesis
with evidence and limit the fix to honest freshness/retry feedback. A faster product
target needs a measured request budget, not an unproven claim that refresh is absent.

## S4: recoverable drafts without silently changing privacy

### Required design decision

Current docs promise memory-only private drafts. **Do not add silent plaintext
localStorage, persist the whole query cache or enable device recovery by default.**
Recommended design: an explicit per-account/per-browser **Recover drafts on this
device** setting, off by default, under Settings. Explain its device-storage boundary,
expiry, sign-out erasure and offline limitations before enabling. No onboarding
wizard, repeated prompt or provider credential is required. Existing opt-outs win.
Owner/security review of this persistence/key policy is a prerequisite to S4 code;
approval of this implementation plan alone is not user consent to turn it on.

### Proposed storage and lifecycle contract

- Store only encrypted draft envelopes in IndexedDB: source, base version/hash,
  notebook/kind/lifetime choices, daily-note identity, exact pending operation/input
  and monotonically increasing local sequence. Never store Bearer tokens, share
  capabilities, queries, media bytes, live promises or a second permission cache.
- Use account/browser-specific non-exportable WebCrypto keys with authenticated
  encryption, unique nonces and schema/version/owner-bound associated data. Review
  key storage and rotation before code. A same-origin persisted CryptoKey is **not**
  protection against XSS or a compromised browser profile; state that limitation.
- Proposed upper bounds for review: 32 drafts/account/browser, 1 MiB encrypted
  total and seven-day absolute expiry without read-based extension. Never evict
  an unsaved draft silently to meet a cap. Unsupported crypto/storage, quota,
  interrupted transactions and unavailable keys retain the memory draft with
  explicit recovery-unavailable feedback and copy/export options.
- Await the IndexedDB transaction before reporting **Recoverable on this device**;
  only a confirmed server note commit may report **Saved**. Persist retry identity
  before network dispatch; checkpoint typing without persisting on every keystroke.
  A last uncommitted typing burst cannot be promised crash-safe: show the actual
  recovery checkpoint and measure the maximum uncheckpointed window.
- On reload, authenticate the same owner and recheck current note/notebook access,
  lifecycle and account state **before decrypting into UI or replaying**. Offline
  session/authorization uncertainty leaves ciphertext locked until validation;
  local keys are not authentication. Never recreate a deleted/archived/expired note
  or revive revoked scope. Retain rejected source only under an explicitly reviewed
  private recovery policy; do not copy it into another notebook automatically.
- Reconcile pending saves by the existing operation ID and expected version.
  Lost create responses must not create duplicates; a newer server version requires
  review. Separate new typing from the request snapshot. Cross-tab writers use
  transaction/sequence fencing and metadata-only notices, not last-writer-wins text.
- Sign-out, account deletion, terminal session denial, explicit disable/forget and
  known note/notebook lifecycle removal clear matching ciphertext/keys and fence
  late async writers. Same-account reauthentication after an interrupted page load
  may unlock an opted-in draft only after fresh authorization. Another account never
  receives it. No remote wipe of an offline browser or exact purge while the browser
  is closed is promised; expired data is unusable and purged at next authorized open.

This is local draft checkpointing, **not** offline background note publication or
a service-worker queue. Explicit retry uses ordinary bounded versioned note writes.
Any later server-side staging/cleanup must reuse existing durable workers, encrypted
scoped staging and explicit retention/erasure—not introduce a parallel job system.
On rollback, keep opted-in envelopes quarantined/readable through the compatible
recovery path or offer explicit copy/export; never erase unsaved work during downgrade.

## Regression and acceptance matrix

| Area        | Automated coverage to extend                                                                                                                 | Required evidence before closing                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval   | `tests/src/search-quality.test.ts`, `ai-cache.test.ts`, `action-quotas.test.ts`, `providers.test.ts`; website search/settings cases          | Cold and cached semantic-only positive, authorized distractor and cross-tenant negative controls; explicit lexical; timeout/429/auth/dimensions/cooldown/quota fallback; recovery; receipt/cursor invariants.                                            |
| Freshness   | Website `tests/cache.spec.ts`, `client-cache.spec.ts`, `workspace.spec.ts`                                                                   | Independent API commit with no reload/broadcast shortcut; complete timer interval, focus/reconnect, clean/dirty/saving/uncertain states, out-of-order replies, offline recovery and 403/404/account replacement; request counts and focus/layout bounds. |
| Drafts      | New focused browser persistence/crypto tests plus existing cache/workspace/daily-note suites                                                 | Reload and browser-process restart; offline failure → online retry; lost create/update response; changed/deleted/revoked source; two tabs; quota/corruption/key loss; expiry, sign-out, account switch/deletion and late-write erasure races.            |
| Connections | `tests/src/client.test.ts`, `client-boundaries.test.ts`, `connect.test.ts`, `opencode-install.test.ts`, installed artifact/native-host tests | Old/canonical/malicious metadata, issuer mismatch, self-hosted origin, expired/valid tokens, cancelled consent/callback, pending/narrow/revoked grants; unchanged old credentials/config; precise CLI and actual-host errors.                            |

Use disposable PostgreSQL with real runtime RLS roles and, for queue changes,
disposable RabbitMQ. Exercise replay, worker crash, lost confirmation, broker outage,
stale lease and lifecycle races. Never reset production/retained databases or weaken
isolation to pass. Chromium and focused WebKit need actual components at 1440,
768, 390 and 320px, including short windows, keyboard, reduced motion and slow
responses. Browser emulation is not physical-device/crash acceptance.

Production acceptance is a separate, owner-approved bounded run against the exact
released source: synthetic scoped notes only, one real OpenCode session plus website,
paired cold/warm semantic queries with a preapproved call/token/spend cap, measured
external edit freshness, isolated opt-in draft profile/restart and canonical reconnect.
Record failures and skipped paths. Preserve test notes/credentials until separately
authorized cleanup. Configuration presence or green fixtures cannot close live gates.

For the initial semantic qualification, propose two synthetic notes (target and
distractor) and three paraphrases with no significant lexical overlap, each cold
and repeated: at most six search requests, no automatic extra attempts. Agree the
provider-token/spend ceiling before running. Each query must execute in hybrid
mode and retrieve its expected target in the first five results; keyword controls
must still work and unauthorized scopes must return no evidence. Record document
and query profile identity, actual latency, cache outcome and accounting without
publishing private text. A degraded result is a failed semantic gate even when
its keyword fallback succeeds.

## Documentation, release and rollback

- S1 updates client/Cloud onboarding and diagnostics; S2 updates search/models,
  caching/metering explanations and request-state UI; S3 updates workspace/cache and
  interaction invariants; S4 updates workspace/cache, device settings and privacy
  disclosures together. Until each slice ships, retain current behavior and limits.
- The Chrome item is public, although the current Connections control still routes
  to manual setup. Correct stale prose now; share one authoritative store-link model
  across Install/Connections in the small implementation follow-up, coordinated
  with #346. A public old version is not approval of the latest submission.
- Run root lint/types/build/artifacts, documentation/format/diff checks and focused
  backend/browser suites per [verification](../development/testing.md). Changes to
  public reference prose also require website build/discovery checks. Add release
  tests/workflow lint if executable release inputs change. Exact-head CI Gate and
  Documentation must pass; no auto-merge or review bypass.
- Follow [patch-first coordinated releases](../release-conventions.md): feature PRs
  target development; Release Please owns versions; production promotion is frozen
  and separately approved. Shared CLI/core changes ship all bundled consumers.
  Optional response fields deploy server first, clients second. Draft storage needs
  a versioned browser schema; any server schema addition requires the explicit
  forward-only owner migration/backup/restore procedure before incompatible rollout.
- Roll back client behavior before removing optional server fields. Keep schemas,
  saved notes, provider-attempt history, existing grants and old credentials. Disable
  new recovery intake without destroying pending drafts. Retest canonical reconnect,
  lexical availability and saved-note access after rollback. Retire only confirmed
  merged, clean task worktrees; planning approval is not merge/deployment authority.
