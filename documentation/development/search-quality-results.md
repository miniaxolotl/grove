# Search-quality measurements

Local synthetic observations, 25 October 2026; not production capacity or an HTTP
SLO. Node 24.21.0, pnpm 10.33.0, PostgreSQL 17.10/pgvector 0.8.2; actual non-owner
API role with tenant/deletion RLS. No paid inference or production data.

`tests/src/performance/search-quality.ts` creates a unique `_test` database,
applies migrations, seeds 1k then 10k eligible notes plus equal-sized other-account
noise, exercises `MemoryService.list`, and removes only its newly created
database. Notes contain ~400-character planting observations and sparse title
matches. Five warm measured calls follow one warm-up per query. The nearest-rank
p95 below is therefore the maximum of only five samples, not a population estimate.

| Eligible + other-tenant notes | Query                | Median service ms | Max of five ms |
| ----------------------------- | -------------------- | ----------------: | -------------: |
| 10k +10k                      | `garden`             |               174 |            185 |
| 10k +10k                      | `garden des`         |               183 |            185 |
| 10k +10k                      | `gardn design`       |               495 |            527 |
| 10k +10k                      | `zzzxylophonequokka` |               714 |            779 |
| 10k +10k                      | `"garden design"`    |               300 |            323 |
| 10k +10k                      | `the` (stop word)    |                26 |             37 |

The first implementation spent ~542–554ms even on ordinary exact/prefix queries.
A short-title resolver fast path, constant empty-tsquery guard and **global
40-match lexical-shortfall gate** reduced those common queries below the initial
local 250ms target. Semantic results do not participate in the shortfall decision.
The decision uses the complete filtered scope before any cursor, including with
explicit date sorts, so later pages cannot activate a new fuzzy regime.

Typo-only/no-match scans remain over 250ms at 10k. Quoted-query and no-match
timings also varied on the shared workstation: an earlier optimized run measured
180/506ms maxima versus 323/779ms in the final run. This is an explicit limitation,
not a claim that all keyword queries meet the target. Queries remain deadline-
bounded. Higher concurrency, cold caches, 50k/Pro-scale corpora, larger imported
notes and real provider latency remain unqualified. Do not infer production
capacity from these small warm runs.

The runner also records a baseline body-only SQL scan (~1–17ms here). That omits
authorization, title resolution, relevance aggregation and presentation and
cannot find typo/prefix-only matches. It is **not** an end-to-end before/after
comparison. Runtime plans use tenant-filtered scans; an owner GIN plan cannot be
substituted as proof of runtime behavior behind RLS. No extra content-trigram
index, policy weakening, elevated helper or global threshold setting was used.

Reproduce with the disposable role URLs from [testing](testing.md#disposable-postgresql)
and an existing `SEARCH_EVIDENCE_DIR`. Private raw runs, initial failures and
actual plans are retained in the task's external plan/evidence directory.
