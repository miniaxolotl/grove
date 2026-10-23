# CI/CD hardening — Grove review

## Implementation update

The owner expanded this review into executable fixes. Grove now shares bounded
GET-only GitHub JSON reads, checksum-preserving bootstrap retries, common-action
pin/checkout contracts and protected browser/Next cache writers with all products.
Three read attempts share a 30-second budget; writes are not replayed and terminal
auth/not-found/persistent invalid evidence fails with redacted diagnostics.

Development PR CI now selects website, backend/contracts/artifacts and image work
by actual dependency families. Shared libraries and package manifests are
conservative; unknown/empty/unreadable diffs select all, docs-only selects none,
and renames include both paths. CI Gate requires exact job/selection inventory,
successful classification/admission and selected success versus intentional skip.
Full push/manual source CI remains independent release evidence. Frozen promotion
PRs/dispatches reuse it only through authenticated admission; a development PR
cannot masquerade as a dispatched promotion. Deployment operations remain unchanged
in this slice. The owner explicitly retained current runner placement, superseding
the vendor move; automatic recovery remains subsequent work. The dated baseline
below is historical where this update supersedes it.

Rollout now re-reads existing app configuration and active/in-progress deployment
identity immediately before its write, rejecting intervening changes without
logging configuration. GitHub operations recheck the protected branch tip before
writing and before success. ACTIVE polling now also requires the provider's actual
active generation and matching API/worker digests, with no newer operation pending.
These fences do not claim atomic provider locking, automatic rollback or hosted
failure-drill acceptance.

Reviewed **22 October 2026**, development `22e76b4dd002be8f2debf13d7d9ea3dfb80484b6`.
This refreshes the recovered plan, not the runtime, workflow or provider settings.
Follow [deployment operations](../deploy.md) for today's supported path and the
[shared review](https://github.com/bramble-labs/website/pull/38) for coordination.
Preserve active workspace #82, media review #83 and their independent worktrees.

The review's fresh browser gate exposed an existing dropdown contrast failure.
The owner separately authorized a baseline repair: remove only the dropdown's
entrance opacity fade so enabled text stays readable from its first frame.
Existing tests/thresholds are unchanged and #82's colour changes remain untouched.
The [synthetic desktop/mobile evidence](../design/screenshots/dropdown-contrast/README.md)
is delivered in a separate fix commit, not presented as pipeline hardening.

## Current baseline and recovery gap

Original commits `40e7a0b`, `923cfbf`, `2843a78` and `2083814` do not resolve after
fetching current remotes; no original hardening branch/worktree is registered.
The old selection/reuse, fenced recovery, runner/cache and bounded read-retry
completion claims are historical. Merged production #81 is not evidence that
unpublished patches shipped. Recover and compare external patches or explicitly
reconstruct them, then establish fresh checks rather than reuse old test counts.

| Area          | Implemented source                                                                                                                                              | Remaining hardening                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CI            | `ci.yml`: unconditional website, contracts/database/artifacts, image and promotion admission; all-success gate                                                  | Dependency-aware validation/deployment selection without weakening the gate                           |
| Runners/cache | `ubuntu-latest`, pnpm dependency and BuildKit image caches                                                                                                      | Blacksmith Linux subject to access/lint; deliberate build/browser caching and measured sizing         |
| Admission     | Frozen source/tag/tree, independent source CI, Release Please and operator selection evidence                                                                   | Authenticated complete-job reuse, explicit expiry/policy revalidation                                 |
| Publishing    | Exact-source npm/container preflights and immutable registry readback/reuse                                                                                     | Preserve existing publication retries; reconcile shared GitHub/bootstrap read work                    |
| Rollout       | `deploy-digitalocean.mjs` preserves existing runtime config, updates API/worker digest and polls a new matching deployment to ACTIVE; workflow checks readiness | Last-good config/schema/identity-fenced recovery, verified rollback, desired-state and alert handling |

Source references: `.github/workflows/ci.yml`, `deploy.yml`,
`scripts/release/promotion.mjs`, `policy.json`, `publication.mjs`,
`scripts/deploy-digitalocean.mjs` and `tests/digitalocean.test.mjs`.

## Findings and required corrections

1. Do not reintroduce the historical double-build design as a supposed current
   defect. Measure current jobs. Selection must follow actual API/worker, shared
   library, native/agent bundle, website, database and lockfile dependencies.
   Unknown/empty/unreadable diffs are conservative; cover both rename sides and
   deletions. Missing/failed/cancelled selected jobs must fail. Keep a complete job
   inventory and preserve independent source CI and promotion admission.
2. Evidence reuse must bind repository, trusted workflow/producer, SHA/tree, run
   attempt, selected jobs, tooling/policy and artifact digest. Reject PR-only/self,
   stale, partial and expired evidence; tree equality or cancellation is not reuse.
3. API/worker image equality and ACTIVE/readiness polling are not automatic recovery.
   Record a verified last-good deployment, image, configuration and compatible
   forward schema. Fence both forward and recovery mutations against newer branch
   or provider operations; recheck before writes, read back ambiguous writes, verify
   restored identity/health, reconcile desired state and alert on failed recovery.
4. An old bootstrap image is not a default rollback target. Current forward schema,
   preferences, lifecycle/queue behavior and runtime configuration must remain
   compatible. Keep retained data, non-owner/RLS isolation and current privacy
   decisions; never down-migrate or restore old authorization state to pass checks.
5. Drain old workers and verify leases, queued jobs, in-flight exports/requests and
   publication fencing before admitting replacement work. Health alone does not
   prove continuity. Hosted failure/recovery drills remain separate acceptance.
6. Preserve existing bounded registry readback; it is not generic GitHub retry.
   Add transient read/bootstrap deadlines with terminal auth/not-found/identity
   failure and digest tests. Do not blindly retry writes or republish versions.

## Policy and runner evidence

Read-only GitHub repository/full ruleset readbacks confirm strict Actions `CI Gate`
(integration `15368`) on development/production, PR/conversation requirements,
no bypass, merge-only production and immutable `promote/**/*` refs/all tags.
Auto-merge is enabled; rebase and delete-branch-on-merge are disabled. Future policy
tooling must report drift before changes and preserve protected/frozen refs.

Blacksmith allocation and cost savings remain desired/unmeasured, not active
configuration. Validate runner access/lint, cache toolchain/lockfile/architecture
keys and trusted writer boundaries. Compare cold/warm job time, queue/retry overhead,
billed compute and cache costs before claiming one vendor is optimal. Do not
enable merge queues, transfer the repository or retire previews as a prerequisite.

## Atomic follow-up and acceptance

| Order | Future slice                     | Required scenarios, not newly passing tests                                                                                                             |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Recover/reconcile and baseline   | Exact-source contracts, lint/types/build/artifacts, real disposable DB/RLS and relevant browsers; preserve independent feature work                     |
| 2     | Dependency selection/gate        | Docs-only, shared bundles/schema/lockfile, rename/delete, unknown/empty/diff failure, selected-job failure/absence and inventory drift                  |
| 3     | Runners/cache                    | Trusted source writes, denied untrusted writes, key invalidation, runner lint, browser/build cache validation                                           |
| 4     | Evidence reuse and bounded reads | Wrong producer/SHA/run attempt, PR/self/partial/expired evidence, transient deadline, terminal failures, write-not-replayed and bootstrap digests       |
| 5     | Drain/deploy/verify/recover      | Healthy, failed rollout/smoke, supersession, incompatible schema/config, failed rollback/alerts, desired-state reconciliation and queued/in-flight work |
| 6     | Authorized hosted closeout       | Exact settings/provider readback, positive/negative recovery drills and measured continuity/costs                                                       |

Keep migrations explicit owner operations and forward-only. Local tests cannot
stand in for hosted acceptance. Plans stay local; publish cohesive assigned,
minimally labelled PRs and require exact-head checks. Remove only clean stale
review worktrees after confirmed merge. This review authorizes no merge,
deployment, database/provider write or hosted activation.
