# Backend capacity

[Measured results and sizing decision](backend-capacity-results.md) retain successful
and overloaded runs. The 50/s sustained and 100/s burst targets remain unqualified.

The API batches note metadata, revisions and conversation sources. Exact semantic
recall scores each eligible 4,096-dimensional vector once and fetches note bodies
after top-k selection. Tenant, grant, current-revision, expiry and AI-preference
checks remain inside PostgreSQL authorization boundaries.

## Admission and cancellation

An authenticated HTTP operation consumes one account/minute reservation, including
MCP protocol requests. Reauthorization during search, chat and export does not
charge additional reservations. The counter commits in a short transaction;
subsequent work rechecks current permissions. Failed admitted operations still
count. The account allowance remains **180 operations/minute**. Direct library
integrations can use `withMemoryOperation` around an external operation.

Ordinary requests and interactive requests have independent process-local limits.
Ask Grove, conversation turns, model tests and streaming exports use the interactive
lane. Full/expired queues return **503 / Retry-After: 1**; account quotas return
**429 / Retry-After: 60**. Clients retain a mutation's operation ID when retrying.
The server does not replay a save automatically.

Request bodies are read only after admission, with a **128 KiB received-byte cap**
regardless of Content-Length. The request deadline interrupts stalled fixed-length
and chunked uploads, releases their permit and leaves health checks available.

Cancellation reaches body reads, queue waits, inference (including model
diagnostics) and tenant transaction boundaries. Cancelled transactions roll back
before commit; active SQL settles under its
statement timeout. A permit is retained until its work settles. Identity SDK calls
retain their own transport behavior. Interrupted exports fail the response stream,
so a partial backup cannot look like a completed download. Health/liveness and
OAuth metadata bypass the work queues.

## Runtime settings

Set database variables **per process/component**. Compose forwards `.env` settings;
use a component environment override when API and worker need different pool sizes.
DigitalOcean image rollouts preserve operator settings; configure overrides on the
appropriate component's runtime environment.

| Setting                         | Default | Meaning                                       |
| ------------------------------- | ------: | --------------------------------------------- |
| `DATABASE_POOL_MAX`             |       8 | Connections per API or worker process         |
| `DATABASE_ACQUIRE_TIMEOUT_MS`   |    2000 | Maximum pool/connect wait                     |
| `DATABASE_STATEMENT_TIMEOUT_MS` |   10000 | SQL statement ceiling                         |
| `API_MAX_IN_FLIGHT`             |      32 | Ordinary active requests                      |
| `API_MAX_QUEUED`                |      32 | Ordinary waiting requests                     |
| `API_QUEUE_TIMEOUT_MS`          |     250 | Maximum admission wait, both lanes            |
| `API_REQUEST_TIMEOUT_MS`        |   10000 | Ordinary cooperative deadline                 |
| `API_INTERACTIVE_CONCURRENCY`   |       4 | Active interactive requests; same waiting cap |
| `API_INTERACTIVE_TIMEOUT_MS`    |   90000 | Interactive cooperative deadline              |

Total connection budget is the sum across **all API and worker replicas**, plus
owner operations and monitoring headroom. Start with eight per process. Increasing
pools or HTTP concurrency cannot repair a CPU/I/O-bound database. Inspect pool wait,
connection hold, SQL duration, lock waits and queue growth before changing limits.

The existing worker's `AI_CONCURRENCY` is separate from foreground admission.
Durable worker lanes, broker fairness and shared cross-replica provider budgets
belong to the queue-processing workstream. API save throughput alone does not
establish sustainable enrichment throughput.

## Reproduce and verify

See the [HTTP/MCP workload runner](../../scripts/performance/backend.md). It uses
fresh disposable databases, non-owner API/worker roles, dense vectors and explicit
provider delays/faults. Run timing experiments sequentially without competing
builds. Keep status distributions, generator drops and processing backlog alongside
latency; a fast rejection is not a successful operation.

`tests/src/capacity.test.ts` gates constant query budgets, same-account overlap,
single-operation accounting, cancellation rollback, pool exhaustion, overload
recovery, stalled uploads through the Node HTTP adapter, received-byte limits,
interactive separation and interrupted downloads. Model tests verify provider
cancellation and retained usage accounting for all three roles. Existing database
tests cover revocation, profile changes, stale evidence and tenant isolation. Browser
cache/editor tests cover stable navigation, typing during saves, focus and retry.

Capacity changes add no schema migration beyond the current AI-preferences **013**
baseline. Production resizing and real-provider throughput qualification remain
explicit deployment operations.
