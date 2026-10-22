# Notebook assistance qualification — 22 October 2026

Implementation: `a312466`; UI integration: `ebdb6d5`, including workspace polish
`22a82fb`. Final dependency integration `1542c08` includes queue `8e444c9` (#79).
Node 24 / pnpm 10.33, owned local PostgreSQL
with non-owner API and worker roles. Fixtures contain only synthetic writing.

## Semantic review

MiniMax `MiniMax-M3.1-Flash`, generation profile
`generation-eca1544834c6366fc9f732b5`, notebook-summary-v2 / assistance-v2 prompts.
The dedicated development credential was used through the real provider adapter
and durable worker. All 30 feature results reached ready; automatic retries were
allowed to finish. Forty-one generation calls include retries and refreshed summaries.

| Subject      | Summary                                             | Actions                        | Filing       | Cleanup                                | Digest                                             |
| ------------ | --------------------------------------------------- | ------------------------------ | ------------ | -------------------------------------- | -------------------------------------------------- |
| Research     | Correlation, small sample, low confidence           | Repeat blinded trial           | Research     | No candidate                           | Trial completion and unsupported causal hypothesis |
| Japan travel | Bookings, budget, optional museum                   | Mira books tickets tomorrow    | Japan travel | No candidate                           | Tickets booked, hotel cancelled                    |
| Study        | Photosynthesis, open chapter 3, completed chapter 2 | Review chapter 3 before Friday | Abstain      | No candidate                           | Chapter 3 completed; unchanged concept omitted     |
| Home         | Unresolved blue/green conflict                      | Ask landlord                   | Home         | Conflict; preserve both claims         | Approved green replaces blue                       |
| Software     | Explicit v2 replacement and open migration test     | Add migration test             | Abstain      | Superseded; retain testing requirement | Schema replacement and completed test              |
| Mixed        | Garden errand and separate reading-group idea       | Buy basil once                 | Abstain      | Exact duplicate                        | Basil purchase completed                           |

Review found all six expected actions with no extra completed/hypothetical tasks,
three correct filing suggestions and three abstentions, and all three positive
cleanup cases with no false positives in the three negative cases. Summaries retain
subject/uncertainty and the explicit replacement. Every published quote passed
exact original-revision validation; edited-note digest claims cite both revisions.
The six expected changed-event groups are present. Some results remain wordy, and
the research digest repeats the completion in a second sentence. This small labelled
corpus is a regression check, not a general accuracy estimate.

The first live pass exposed an explicitly superseded instruction described as an
unresolved conflict, a one-sided digest restatement, and snapshots taken before
scheduled retries finished. Prompt refinement, both-sided edit validation and a
bounded terminal-state runner corrected these. Invalid evidence still fails closed;
deterministic tests also reject invented action quotes and age-only supersession.
The runner now emits provider token accounting for future runs; this recorded pass
retained call/source-character counts, not token totals.

## Scale and reuse

`pnpm exec tsx scripts/testing/notebook-assistance.ts --benchmark` runs actual
database/worker orchestration with deterministic synthetic generation. Each note
has about 550 source characters. UUIDs are randomly generated per run. Times are
single local observations on a shared host, not provider latency or capacity limits.

|  Notes | Pass      | Time ms | SQL queries | Model calls | Source characters |
| -----: | --------- | ------: | ----------: | ----------: | ----------------: |
|    100 | Initial   |   1,252 |       1,277 |          33 |            61,265 |
|    100 | Unchanged |     372 |          53 |           0 |                 0 |
|    100 | One edit  |     287 |         333 |           5 |             5,459 |
|  1,000 | Initial   |  13,538 |      13,741 |         361 |           621,863 |
|  1,000 | Unchanged |      32 |          53 |           0 |                 0 |
|  1,000 | One edit  |     612 |         605 |           9 |             5,970 |
| 10,000 | Initial   | 137,350 |     137,455 |       3,615 |         6,231,670 |
| 10,000 | Unchanged |      69 |          53 |           0 |                 0 |
| 10,000 | One edit  |     804 |         809 |          12 |             7,173 |

Maximum observed generation input: 4,408 source characters; maximum sampled process
RSS: 385,359,872 bytes (367.5 MiB). The runner's deliberately terse fake output cites
one note at the root; coverage still reports every note examined. Token costs are
not inferred from synthetic generation. Production keeps its configured daily budget,
so a large first pass may span budget windows.

The first implementation reused leaf inference but traversed the whole tree on every
refresh: at 10,000 notes, unchanged refresh took 141,601 ms / 111,440 queries and one
edit took 126,336 ms / 111,524 queries. Transactional UUID-prefix invalidation now
retains valid subtrees, including their earliest expiry. Tests cover insertion, edits,
both sides of moves, uncited expiry, deletion, restart and stale publication.

The integrated large-export check emits 2,000 records in pages no larger than
623,300 bytes. It now distinguishes an account-lock `SKIP LOCKED` miss from terminal
completion. Its focused run took 841 ms with 13.7 ms concurrent foreground-read p95;
full-suite runs took 1,921–1,942 ms with 57.3–73.4 ms p95 under concurrent test load.

## Reproduction and evidence

See [verification](testing.md) for disposable database setup and
[notebook assistance](../notebook-assistance.md#verification) for runner commands.
Labelled fixtures live in `tests/fixtures/assistance-quality.ts`. Full final evaluation
JSON and available verification logs are retained in the ignored canonical
`plans/notebook-assistance/evidence/` execution record; earlier findings are recorded
above. Reviewed synthetic UI captures
are tracked under `documentation/design/screenshots/notebook-assistance/`.
