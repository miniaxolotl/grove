# Durable background work

Migration **014** adds `background_tasks` for exports, cleanup, model backfills,
imports and connector sync. Inference keeps `jobs`; email keeps its outbox.
PostgreSQL owns eligibility, checkpoints, retries and leases.

Migration **033** adds [exact AI-work caching](ai-caching.md). Enrichment jobs can
reuse unchanged text/configuration artifacts without another provider reservation,
but still publish only to the current note version under the current preference,
profile, source and lease guards. Classification also fences candidate versions.
Cache eviction/expiry never deletes retained authored records. Account/retention
tasks remove derived cache/backoff rows in bounded existing checkpoint stages;
restore/model reset clears them and invalidates older processing generations.

## Capacity and recovery

| Lane        | Worker capacity             | Work                                                |
| ----------- | --------------------------- | --------------------------------------------------- |
| indexing    | `INDEXING_CONCURRENCY=2`    | Embeddings                                          |
| enrichment  | `AI_CONCURRENCY=4`          | Classification, organization, relationships, briefs |
| email       | `EMAIL_CONCURRENCY=1`       | Transactional mail                                  |
| maintenance | `MAINTENANCE_CONCURRENCY=1` | Account, retention and artifact cleanup             |
| bulk        | `BULK_CONCURRENCY=1`        | Exports, imports, backfills and sync                |

`WORKER_LANES` selects comma-separated lanes for a replica; zero capacity disables
an optional lane. Broker and polling consumers share each replica's capacity gates.
`JOB_ACCOUNT_CONCURRENCY=2` caps inference per account/lane across replicas;
`JOB_PROVIDER_CONCURRENCY=8` caps each inference lane across the installation.
These reservations cover background inference; interactive admission is separate.
Configured Cloud additionally shares **two generation-call slots/account** across
interactive requests and every worker lane/replica. Slots use 120-second leases,
renew every 30 seconds and release on completion/failure/cancellation; expired
leases recover after a crash. This does not expand provider-wide capacity.
Bulk/maintenance allow one task per account/lane; email allows one per account.
Least-recently-claimed accounts and bounded dispatch batches spread work fairly.

Claims have random fencing tokens and 120-second leases. Tasks and inference renew
every 30 seconds. Business writes and checkpoints commit together. Model switches
advance an epoch and enqueue one backfill; superseded epochs cannot publish.
Backfills scan at most 250 notes per checkpoint (worker default 100), exports/cleanup
use 100 records, and imports 10. Five consecutive failures exhaust a task; successful
checkpoints reset the budget. Exponential retries include jitter. Task attempts have
a 15-minute ceiling to accommodate streaming artifact assembly.

The [action allowances](billing.md#library-and-user-actions) are distinct from these
provider attempts. Monthly-exhausted organization jobs defer to the actual UTC
month boundary without consuming a failure attempt; temporary account generation
saturation retries shortly. Indexed source notes remain saved. On-demand assistance
and summary fragments share their request reservation; valid cached fragments do
not each consume another action. API and worker require matching action policies.

SIGTERM stops admission, drains work and requests cancellation after 25 seconds.
Unresponsive providers cause an exit at 35 seconds; allow at least 40 seconds of
shutdown grace. Leases recover interrupted processes. Inspect
`queue_status` for per-lane pending/running/failed counts and oldest due age. Logs
contain no payloads. Operators can inspect error codes/checkpoints in PostgreSQL.
After resolving a terminal maintenance failure, resume it with `status='pending',
failures=0, due_at=now(), error_code=NULL, finished_at=NULL` and cleared lease/dispatch
fields. Preserve its cursor; never reset a running task's fencing token.

## Broker rollout

Worker-only `AMQP_URL` selects RabbitMQ and requires TLS. Disposable broker tests
connect directly through `TEST_AMQP_URL`.
`grove.jobs.v2.<lane>` queues carry only `{kind,id}`. Atomic dispatch reservations
expire after 30 seconds; publisher confirms and failures are token fenced.
A 15-second redispatch window recovers lost messages. Retries remain in PostgreSQL.
Each queue holds at most 10,000 messages with a one-hour TTL and reject-publish
overflow. The worker reconnects and uses database polling during broker outages.

`WORKER_LEGACY_QUEUE=true` drains `grove.jobs.v1` through the same capacity gates.
Stop old workers before 014 rollout. Disable the legacy consumer after draining;
retire the old queue only through a separate operator action.

## Exports and storage

Settings → Your data and Notebook options → Export notebook prepare background
exports. Notebook exports default to direct notes; sub-notebooks are opt-in.
Progress, cancel, retry and download survive navigation. Stable request UUIDs make
lost create responses safe to retry. Typed NDJSON records are `notebook`, `note`,
`revision`, `conversation`, `turn`, `note_relationship`, `notebook_relationship`,
`notebook_checkpoint`, `notebook_visit`, `assistance_review` and
`assistance_operation`. Notebook exports omit conversations and account-wide
assistance reviews/operations.

Default v2 exports contain structured records. With `includeMedia:true`, v3 adds
checksummed original-media metadata and bounded base64 chunks for authorized
current/history bindings; see [media exports and recovery](media.md#exports-and-recovery).
Source bytes live in a separate durable store. Do not store authored media in the
expiring export bucket.

Workers page source records into private parts, then stream final assembly.
Buffers are bounded by a 100-record page; S3 assembly uses two 5 MiB buffers.
A source-change counter fences every page and final publication. Concurrent edits
or deletion invalidate an export; Retry prepares a fresh copy. This avoids holding
a database snapshot for the whole job. Deleted records are excluded. Downloads
expire after one day.

Configure the **same store** on API and workers:

- Self-hosting defaults to `EXPORT_STORAGE=local`, `EXPORT_DIRECTORY=./data/exports`.
  Compose mounts a shared persistent `exports` volume at `/app/data/exports`.
  Multiple hosts need a shared filesystem or S3.
- Cloud defaults to `disabled`. Set `EXPORT_STORAGE=s3`, `EXPORT_S3_BUCKET`,
  `EXPORT_S3_REGION`, `EXPORT_S3_ACCESS_KEY_ID`, `EXPORT_S3_SECRET_ACCESS_KEY`.
  Compatible stores also support `EXPORT_S3_ENDPOINT` and `EXPORT_S3_PATH_STYLE=true`.
- Keep the bucket private. Grant bucket HEAD/list and object get/put/delete plus
  multipart upload/abort under `exports/`; use HTTPS outside local tests. Configure
  bucket lifecycle to expire this prefix and abort incomplete multipart uploads
  after one day. Storage provisioning is an explicit operator action.

Read-aloud audio also uses this store, under `narration/` with get/put/delete
permission and **no age-based bucket expiry**. Its matching-text lifetime and
seven-day stale grace are managed by the application, independently of one-day
exports and legacy `speech/` objects. See [speech retention](speech.md#temporary-output-and-recovery).

Readiness validates configured storage. Downloads are session-owner-only,
`private, no-store` streams through API/BFF, with authorization rechecked during
long transfers. No public object URLs or credentials reach the browser.
Downloads use the API's interactive admission lane and deadline; interrupted
transfers fail the response, stop storage reads and release their permit. Rechecks
share the original request's account quota reservation. Task creation/status/control
use ordinary HTTP admission; worker checkpoints do not consume request quota.
`artifact_cleanup` removes expired tracked parts and abandoned objects; provider
lifecycle covers process crashes during multipart requests. Tracked expiry also
removes local `.partial` files left by terminated processes.

### API

Session-owner routes:

- `POST /v1/exports`: `{id, projectId?, includeDescendants?: false}` →202/task.
- `GET /v1/tasks[?projectId=UUID]`: latest 10 user jobs; `GET /v1/tasks/:id`.
- `POST /v1/tasks/:id/cancel` or `/retry`: resume or stop durable work.
- `GET /v1/tasks/:id/download`: current unexpired export only.

Task responses expose status/counts/timestamps and sanitized errors, never payloads,
storage keys or connector credentials. `GET /v1/account/export` now returns 410;
clients must create an export and wait for its download. Queue admission limits
each account to 20 outstanding user jobs and one active export.

## Imports and connectors

Session owners can `POST /v1/imports` with `{id,source,records}`. Each record has
`sourceId`, `content` and optional `projectId`; send at most 100 records and 128 KiB per
request. Split larger inputs into requests with distinct stable UUIDs. Each task
commits 10 records and its cursor together. Source IDs deduplicate retries; updates
retain normal revisions. Divergent local edits fail with `import_conflict`; remote
updates cannot revive a locally deleted note.

`ConnectorAdapter.page()` returns a bounded page, opaque cursor, completion flag
and optional retry delay. Register adapters with `importHandlers` and enqueue using
`enqueueConnectorSync` inside a tenant transaction. Resolve credentials inside the
adapter. Source mappings and checkpoints commit with ordinary memory writes and
their task lease. This feature configures no third-party connector.

## Retained deletion

Notes, revisions, notebooks, conversations and connection records are soft deleted.
Restrictive RLS hides tombstones and dependent history; public readers filter them
explicitly. Authored records have no automatic physical-purge deadline. Derived
vectors, expired export files and operational scratch may be removed. Account
deletion revokes access immediately; cleanup progresses independently of identity
provider outages. Recovery replays tombstones and invalidates restored tasks and
downloads without erasing retained authored records.

## Local capacity evidence

On Node 24/PostgreSQL 17, a synthetic 1,000-note/2,000-record export completed in 742 ms
while foreground account reads continued. Largest serialized page was 623,300 bytes;
observed RSS growth was 34.7 MiB. Read p95 was 16.5 ms before and 14.3 ms during this run.
This is a local regression fixture, not a hosted throughput guarantee. Reproduce
with the final test in `tests/src/queue.test.ts`; it asserts page bounds and complete
output rather than machine-specific timing thresholds.
