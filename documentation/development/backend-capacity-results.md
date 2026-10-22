# Backend capacity measurements — 22 October 2026

**The deterministic query reduction is verified. The 50 sustained / 100 burst
requests-per-second targets are not qualified.** The final 20/s, two-minute read
run returned 2,398/2,400 successful responses, with 209 ms p95 and no generator drops
(0.083% errors). This is a local observation, not a production service guarantee.

## Conditions and reproduction

- Node **24.21.0**, pnpm **10.33.0**, Linux x64, Ryzen 9 5900X host. The host is
  shared with other workstreams; it is not an isolated performance laboratory.
  These load runs were sequential, without this workstream's builds/tests running.
- PostgreSQL 17 / pgvector 0.8.2 container, image
  `sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966`.
  Default limit: **1 CPU / 1 GiB**; the two sizing cases use **2 CPUs / 2 GiB**.
  Container limits were restored afterward. No production resources were changed.
- Real HTTP, authorization, RLS, SQL and official-SDK MCP preflight; disposable
  databases and non-owner API/worker roles. Only identity token verification and
  model outputs are substituted. API and generator share an unconstrained host
  process, so these runs do not qualify a 1-vCPU API deployment or remote Neon.
  Broker delivery, model-registry refresh and periodic maintenance are not running.
- Eight connections per pool; 64 generator requests maximum; current API admission
  is 32 ordinary active + 32 waiting, four interactive active + four waiting.
  Admission wait is 250 ms. Pool acquisition is 2 s and statement timeout is 10 s.
- Synthetic notes are approximately 500 characters, all personal, with ready
  enrichment and dense **4,096-dimensional** vectors (eight distinct vectors).
  `garden` matches every note lexically and approximately one eighth semantically.
  Empty search uses `unmatchedword` and vector seed `999`.
- Embedding/classification delay is 100 ms; generation is 500 ms per call. Chat
  makes two generation calls plus retrieval. Relationships abstain. Account rate
  limits remain real; the fixture's daily inference allowance is raised to
  1,000,000 to isolate throughput from that separate product quota.
- Mixed traffic is 75% list / 20% search / 5% save with four fallback worker jobs.
  With 20 accounts, the deterministic schedule concentrates saves on one account
  and searches on four others. This is a hot-writer case, not balanced write load.
  Job counts include unfinished and delayed jobs, not just ready-to-run backlog.
- No warm-up window is discarded. p95 below includes successful and rejected HTTP
  responses; drops are requests the generator could not start. Interpret all three
  together. Numeric pool/SQL samples retain the last 20,000 observations.

Use [the runner](../../scripts/performance/backend.md) on the source named in the
tables. Each row supplies account count, notes/account, arrival rate and duration;
remaining defaults are above. For example:

```sh
pnpm perf:backend --accounts 20 --notes 1000 --rate 20 --seconds 120 --output read.json
pnpm perf:backend --accounts 20 --notes 1000 --rate 20 --seconds 60 --workload mixed --worker 4 --output mixed.json
pnpm perf:backend --accounts 5 --notes 10000 --rate 5 --seconds 20 --workload recall --output recall.json
```

The relay case adds **2 ms per TCP chunk in each direction** between the fixture
and disposable PostgreSQL. It is simulated transport delay, not a Neon measurement.
All cited source trees were clean. `260d90b` includes the final post-lock revocation
fix; subsequent workspace integration changes only website/documentation files.
The canonical local plan retains full JSON, EXPLAIN and logs for every row.

## Query scaling and exact search

| Source                        | HTTP list 1 / 30 / 100 notes | MCP recall |
| ----------------------------- | ---------------------------- | ---------: |
| Integrated baseline `67b0986` | 15 / 131 / 411               |         74 |
| First candidate `116f4c2`     | 21 / 21 / 21                 |         56 |
| Final `260d90b`               | **15 / 15 / 15**             |     **41** |

The 100-note page uses **96% fewer queries**, and the 30-note page uses 89% fewer.
Single-note presentation, export revisions and conversation sources use the same
batched path. The deterministic tests enforce page-size independence and current
tenant/revision/expiry/preference fences.

Paired exact-recall profiling at 10,000 notes/account, 2/s for 15 s:

| Metric                    | Before `35eaf02` | After `116f4c2` |
| ------------------------- | ---------------: | --------------: |
| HTTP p95                  |        494.09 ms |       468.84 ms |
| Pool hold p95             |        206.80 ms |       152.05 ms |
| SQL p95                   |         25.61 ms |        20.08 ms |
| Single EXPLAIN execution  |        212.10 ms |       235.49 ms |
| Shared block hits + reads |           61,963 |          51,683 |
| Success / total           |          30 / 30 |         30 / 30 |

The new materialized candidate query removes 1,300 repeated correlated embedding
lookups in this fixture. The single EXPLAIN execution itself was slower; the report
does not infer universal latency improvement from one query plan. All coordinates,
exact distance filtering and tenant/profile/revision checks remain in use.

## Final implementation and sizing

`A × N` means accounts × notes/account. Rate/duration is offered requests/s / seconds.
`Jobs` is remaining worker jobs after requests settle. All HTTP statuses in these
runs were 200 or 503.

| Case                                    | Source    | A × N     | Rate / duration |  p95 ms |  200 |  503 | Drops | Jobs |
| --------------------------------------- | --------- | --------- | --------------- | ------: | ---: | ---: | ----: | ---: |
| Read                                    | `8469af5` | 20 × 100  | 20 / 15         |   24.72 |  300 |    0 |     0 |    0 |
| Steady read                             | `8469af5` | 20 × 1000 | 50 / 60         | 2891.86 | 1323 | 1513 |   164 |    0 |
| Burst read                              | `8469af5` | 50 × 1000 | 100 / 60        |  484.14 | 5512 |  426 |    62 |    0 |
| Soak read                               | `8469af5` | 20 × 100  | 50 / 180        |  199.59 | 8790 |  196 |    14 |    0 |
| Mixed + worker                          | `8469af5` | 20 × 1000 | 20 / 60         |  305.15 | 1200 |    0 |     0 |  172 |
| Mixed pressure                          | `8469af5` | 20 × 1000 | 50 / 30         | 1335.35 | 1282 |  173 |    45 |  291 |
| Empty search                            | `8469af5` | 1 × 10000 | 2 / 15          |  502.82 |   30 |    0 |     0 |    0 |
| Large recall                            | `8469af5` | 5 × 10000 | 5 / 20          | 7837.88 |   40 |   60 |     0 |    0 |
| Chat                                    | `8469af5` | 20 × 100  | 2 / 20          | 1627.88 |   40 |    0 |     0 |    0 |
| Chat overload                           | `8469af5` | 20 × 100  | 8 / 10          | 1413.03 |   34 |   46 |     0 |    0 |
| Search, every fifth provider call fails | `8469af5` | 20 × 1000 | 20 / 15         |  782.22 |  300 |    0 |     0 |    0 |
| Same-account reads                      | `8469af5` | 1 × 100   | 20 / 5          |  111.84 |  100 |    0 |     0 |    0 |
| Low-write mixed                         | `8469af5` | 20 × 1000 | 5 / 60          |  148.14 |  300 |    0 |     0 |   12 |
| Final steady read                       | `260d90b` | 20 × 1000 | 20 / 120        |  208.70 | 2398 |    2 |     0 |    0 |
| Final read with relay                   | `260d90b` | 20 × 100  | 20 / 30         |  102.22 |  600 |    0 |     0 |    0 |
| **2-CPU sizing**, burst read            | `260d90b` | 50 × 1000 | 100 / 60        |  359.77 | 5845 |  127 |    28 |    0 |
| **2-CPU sizing**, large recall          | `260d90b` | 5 × 10000 | 5 / 20          |  508.69 |  100 |    0 |     0 |    0 |

The final steady run's pool wait/hold p95 is **0.04 / 21.09 ms**, SQL p95 **1.26 ms**,
and sampled process RSS peaks at **333 MiB**. The two-CPU burst's pool wait p95 is
36.61 ms and RSS peaks at 541 MiB. These figures include the generator and fixture;
they are not isolated API memory requirements. The combined CPU/memory resize
improves the large-recall observation but does not identify which resource caused
the earlier stalls.

In the final mixed 20/s run, successful read/search/save p95 is **215/538/367 ms**.
Sixty writes at 1/s leave **172 jobs** after 339 jobs were serviced, with peak queue 177. At 0.25 writes/s, 15 writes leave 12 jobs (peak 18) after 119 serviced jobs.
The latter is encouraging but too short to establish steady-state processing.
**Sustainable write/processing capacity remains unqualified.** Queue-processing
owns the next lane/broker/fairness integration and drain/soak qualification.

The provider-failure case returns 240 hybrid and 60 lexical responses, preserving
usable search. Chat saturation returns bounded 503s; separate deterministic HTTP
tests verify that it leaves ordinary navigation available and recovers afterward.
Two synthetic replies/s is not a real-provider concurrency commitment.

## Earlier iteration retained for comparison

These results explain why a single successful 50/s run was not accepted as a limit.
The baseline and first candidate used the same real database/HTTP path; candidate
`116f4c2` preceded the redundant-query removal and final revocation fix.

| Case               | Source    | A × N     | Rate / duration |  p95 ms |  200 |  503 | Drops | Jobs |
| ------------------ | --------- | --------- | --------------- | ------: | ---: | ---: | ----: | ---: |
| Baseline read      | `67b0986` | 20 × 100  | 20 / 15         |   54.86 |  300 |    0 |     0 |    0 |
| Candidate read     | `116f4c2` | 20 × 100  | 20 / 15         |  115.19 |  300 |    0 |     0 |    0 |
| Steady read        | `116f4c2` | 20 × 1000 | 50 / 60         |   57.52 | 3000 |    0 |     0 |    0 |
| Burst read         | `116f4c2` | 50 × 1000 | 100 / 60        |  962.37 | 4318 | 1655 |    27 |    0 |
| Soak read          | `116f4c2` | 20 × 100  | 50 / 180        |  832.60 | 8717 |  282 |     1 |    0 |
| Mixed + worker     | `116f4c2` | 20 × 1000 | 20 / 60         |  154.37 | 1200 |    0 |     0 |  162 |
| Mixed pressure     | `116f4c2` | 20 × 1000 | 50 / 30         |  146.70 | 1500 |    0 |     0 |  249 |
| Empty search       | `116f4c2` | 1 × 10000 | 2 / 15          |  996.98 |   30 |    0 |     0 |    0 |
| Large recall       | `116f4c2` | 5 × 10000 | 5 / 20          | 3986.85 |  100 |    0 |     0 |    0 |
| Chat               | `116f4c2` | 20 × 100  | 2 / 20          | 1839.72 |   40 |    0 |     0 |    0 |
| Chat overload      | `116f4c2` | 20 × 100  | 8 / 10          | 1473.13 |   32 |   48 |     0 |    0 |
| Faulted search     | `116f4c2` | 20 × 1000 | 20 / 15         |  877.03 |  300 |    0 |     0 |    0 |
| Same-account reads | `116f4c2` | 1 × 100   | 20 / 5          |   22.53 |  100 |    0 |     0 |    0 |

An earlier `f43fadd` baseline completed only 212 of 300 offers, dropping 88 at the
generator ceiling. It predates preference integration and is not the paired
baseline. Across candidates, workload size, cache state and shared-host contention
produce substantial tail variance. Lower SQL counts are reproducible; high-rate
latency and error improvements are not uniformly reproducible here.

## Deployment decision

Keep the default eight connections per process and bounded admission. The measured
low-rate envelope supports continuing with these conservative defaults; it does
not justify advertising 50 sustained or 100 burst requests/s. Prefer an isolated
staging API/worker and production-like database/network run before resizing or
changing connection budgets. Include checkpoint/storage pressure, concurrent real
provider work, multiple API replicas, current queue lanes and a longer drain/soak.

The two-CPU/2-GiB database is a candidate for that next large-search test, not an
automatic production recommendation. Do not increase connections simply to hide
queueing. Set product capacity only when ordinary and search latency targets,
error/drop budgets and processing backlog all hold together.

Correctness verification passes **110 backend/service tests**, including the
post-lock session-revocation race, plus root lint/types/build and five packaged
artifacts. Browser checks cover navigation, stable search, typing through held
saves, cache invalidation and overload recovery; they use controlled workspace
fixtures, not a new live Clerk/Neon end-to-end timing measurement. See
[delivery evidence](../delivery.md) for the final integrated browser counts.
