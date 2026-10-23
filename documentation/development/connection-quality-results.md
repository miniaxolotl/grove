# Connection quality verification

## Scope and status

This work tightens automatic note/notebook connections and notebook cleanup using
specific source-backed bridges, explicit abstention and policy-versioned derived
assessments. It does not add external enrichment or cross-notebook note discovery.
Implementation is in progress; this document is not production acceptance.

## Historical synthetic baseline

An ignored local report for source `6ab8fad` records **30/38** supplied-pair label
matches using the old policy. Eight expected abstentions were positive links:
film review template, ice/template-only recipes, rejected gin variant, generic
perfume praise, missing perfume attributes, place homonyms, notebook category and
project-only overlap. These reconstruct failure patterns, not original personal
notes. Missing historical usage/cost data is not inferred.

The original corpus has been inspected during development, including cases marked
held-out. Those split labels are historical partitions, not evidence of an unseen
final evaluation set. Supplied-pair results do not measure discovery recall.

## Deterministic discovery observations

The current text-only database fixture nominates **18/18 labelled positive note
pairs**, each within its own notebook among eight template distractors. It uses
the real lexical query and bounded candidate selection, without embeddings or a
generation provider. A separate regression with forty template distractors failed
before the SQL shortlist fix and now nominates the recorded director. Two lexical
queries reserve at most sixteen rows each for broad and least-represented hints;
reranking alone could not recover a note excluded by the original single shortlist.
This does not establish general semantic accuracy or saturated-shortlist recall.

The labelled notebook fixture nominates **4/4 positive notebook pairs**, each among
six unrelated notebooks without embeddings or generation. The isolated run took
1,494 ms including fixture writes and used at most 56 SQL statements for all eight
profile builds, candidate discovery and both-side source selection per case. This
small local observation is not a production latency/capacity estimate.

Four additional database regressions initially failed, then passed after bounded
notebook-discovery changes:

- A minority studio hint survives six template-heavy candidate notebooks, even
  when only one shared term nominates it for assessment.
- A lexical-only nomination survives six vector-only neighbors within five pairs.
- Source selection reaches a middle-aged supporting note outside the representative
  set; common template terms no longer take the first twelve lexical hints.
- A rare subject survives a vocabulary dominated by more than 128 frequent terms;
  retained terms remain bounded at 128, with a minority-hint reservation.

These are targeted adversarial fixtures, separate from the four labelled pairs.
Profiles keep up to five hints per retrieval channel, but still propose at most
five pairs. Sources remain capped at eight notes / 12,000 characters per side.

### Structural query/input budgets

Compared with the pre-change code, lexical nomination uses at most two SQL queries
instead of one and fetches at most 32 rows instead of three; these are code bounds,
not a paired latency benchmark. The second query uses bounded statistics from the
first sixteen results, not one query per term or an account-wide text scan. Exact
and vector channels retain their existing bounds. Each pair still uses one model
call, including cached abstention reuse; no entity-extraction or verifier call is
added. Notebook discovery reads twenty profiles per page and retains at most ten
candidate hints, projecting those into five assessment jobs.

## Reassessment regression

An exhausted current-policy job previously excluded its pair from old-policy
reconciliation even after sources changed. A new note/notebook regression fails
before the fix and passes with explicit source-version/expiry job snapshots.
Unchanged failed jobs remain exhausted, allowing later old-policy pairs to advance.
An additional regression covers PostgreSQL sub-millisecond expiry precision so
the same first twenty failed pairs do not repeatedly occupy the backfill window.
The database comparison uses the same millisecond precision as JavaScript Dates.

## Remaining qualification

- Extend corpus breadth and characterize discovery overhead against a paired
  runtime baseline; current small fixtures are not a broad recall guarantee.
- Complete approved semantic qualification before PR readiness; hosted deterministic
  verification is recorded below, not a substitute for that gate.
- Agree provider/model, actual-request/token/spend limits and semantic targets
  before another paid evaluation. Freeze an independent evaluation set; report
  exact counts, errors, explanation support and usage separately from retrieval.
- Record final verification and its source identity before PR readiness.

No current-policy live accuracy result is available. The prior current-policy
output file was empty, not a successful run. Repeated synthetic runs are not
independent labelled examples or a general production accuracy estimate.

## Local verification checkpoint

Application source is `eb64413`; runner tests/tooling are `e726c23`, integrated
with development `ad1b9fe`. Node 24.21.0 and pnpm 10.33.0 use newly owned PostgreSQL
17 / pgvector 0.8.2, owner migrations and separate non-owner API/worker roles.
The final combined suite passes **279 tests**, with four optional RabbitMQ/S3
skips. All **nine packaged artifacts**, root/website lint and types, root build and
telemetry-enabled website production build pass. The combined suite includes
all **nine runner tests/subtests** without paid provider access.

The later test-only agent follow-up #104 (`1dd5aec`) is integrated in `cfbdc46`.
Runtime and evaluation source are unchanged; fresh root lint/types, all nine
artifacts, five affected client-boundary tests and the complete **279-pass / four-skip**
backend suite also pass on that integration. A restart changed the disposable
container's ephemeral host port; the private verification wrapper now resolves
its actual mapping rather than retaining a stale address. No database was reset.

The affected browser fixture cases pass **eight Chromium** and **four iPhone/WebKit**
scenarios (Playwright 1.64.1 Noble container). Notes entry is **488,019 gzip bytes**;
the existing budget and deferred-editor gate pass. Website application/test source
is unchanged from development. No screenshots are added: this changes backend
selection/assessment, not the visual design, and synthetic provider screenshots
would not prove live semantic quality.

Initial failures are retained in execution notes: the test base database needed
development's forward media/speech migrations; host WebKit lacked dependencies;
and an extra Chromium-native-fullscreen assertion is unsupported on iPhone WebKit.
The supported focused WebKit cases pass without changing frontend assertions.

Runner regressions first reproduced repeated fatal provider calls, disabled/default
provider selection sending credentials, absent report output and missing transport
caps. Local HTTP fixtures now prove bounded actual requests (including failed or
concurrent attempts), fatal abort across repetitions, explicit provider/model
selection, token accounting and atomic completed-report publication. No paid
credential retrieval or live generation was performed for this checkpoint.

## Hosted draft verification

Owner-approved [draft PR #105](https://github.com/miniaxolotl/grove/pull/105) keeps live
semantic qualification explicitly pending. Full
[CI 40034164506](https://github.com/miniaxolotl/grove/actions/runs/40034164506) succeeds
on application/test candidate `83dd0a80b2095f43592512462d810fc60cce6931`: classification,
admission, container, backend, website and CI Gate all pass, as does GitGuardian.
Hosted results include **281 backend passes / two optional skips**, **nine packaged
artifacts**, **223 Chromium scenarios**, agent contracts and release/workflow checks.
The extra backend coverage uses disposable CI services, not production providers.

The last candidate change only makes evaluator tests initialize their own scratch
directory; an isolated fresh-container run reproduced the missing-directory failure
and then passed all nine evaluator tests/subtests. No application behavior or
frontend assertions were changed to obtain passing CI. No paid generation, review
request, merge or deployment occurred. Source and CI links are also retained in the
PR; documentation-only evidence updates do not imply a new model-quality result.

## Rollout boundary

There is no new SQL migration. Matching API/worker versions require a coordinated
pause/drain of old enrichment consumers; profile separation alone cannot prevent
arbitrary old binaries overwriting canonical pairs. See
[rollout](../deploy.md#connection-quality-policy-cutover). No production notes,
backfill, migration or deployment are part of local verification.
