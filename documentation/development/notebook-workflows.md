# Notebook workflows — implementation proposal

**Status: planned, not implemented.** Architecture baseline: development `3041590`,
refreshed against `05fe8fd` on 25 October 2026. This proposal covers weekly review,
meeting preparation, study mode, knowledge gaps and similar past problems. It does not enable features,
authorize paid inference, change allowances or schedule production work.

## Outcomes and first-release boundaries

| Workflow              | Entry and input                                                                  | Output                                                                   | First-release boundary                                                                      |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Weekly review         | Notebook options; select notebook, week and optional recurring delivery          | New ideas, changed decisions and still-open actions, with sources        | In-app review first; recurring generation is explicitly opt-in, not email                   |
| Meeting preparation   | Notebook options or selected notes; meeting title/agenda and optional date       | Relevant decisions, previous recorded discussions, open questions        | User-supplied agenda; no calendar or attendee integration                                   |
| Study mode            | Selected saved notes or a notebook with visible coverage; choose format and size | Source-linked quizzes, flashcards and explanations                       | Bounded practice set with reveal/self-assessment; no automatic grading or spaced repetition |
| Knowledge gaps        | Notebook options; optional topic/question                                        | Recorded unanswered questions and claims needing evidence, with reasons  | Findings about reviewed notebook evidence, not universal truth or automatic web research    |
| Similar past problems | Ask Grove or a notebook action; describe an issue                                | Earlier problem/solution pairs, why they match and important differences | Explicit request, not continuous editor monitoring; no automatic application of a solution  |

Use notebook-local scopes by default. Cross-notebook search requires a visible,
explicit scope choice. Notebook hierarchy never implicitly includes descendants.
Generated output is read-only until the user explicitly chooses a reviewed save.
Keep the existing assistance actions and automatic Ask experience compatible.

## Existing architecture to extend

| Existing implementation                                                                   | Reuse                                                                                             | Missing behavior                                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lib/shared/src/assistance.ts`, `lib/memory/src/assistance.ts`                            | Typed requests, durable UUID/fingerprint, owner-session authorization, preview states, Apply/Undo | Five workflow contracts, richer coverage and explicit cancellation/retention behavior                         |
| `lib/memory/src/notebook-digests.ts`                                                      | Change ledger, before/after revisions, unavailable-source redaction                               | Calendar windows independent of visits; unchanged outstanding actions                                         |
| `lib/memory/src/assistance-actions.ts`                                                    | Evidence-backed action extraction                                                                 | Whole-notebook bounded scanning and cross-note completion reconciliation                                      |
| `lib/memory/src/notebook-summaries.ts`                                                    | Checkpointed bounded fragments and reductions                                                     | Task-specific fragments; summaries alone cannot prove a missing answer or completed action                    |
| `lib/memory/src/assistance-data.ts`, `lib/shared/src/summaries.ts`                        | Exact note ID/version/quote checks, source and scope dependencies                                 | Per-item workflow validation and explicit partial/omitted evidence metadata                                   |
| `lib/memory/src/assistance-jobs.ts`, `job-lease.ts`, `tasks.ts`                           | Existing enrichment lane, durable progress, leases, profile/preference and publication fences     | Recurrence admission and new resumable workflow steps, not a new queue system                                 |
| `lib/memory/src/search.ts`, `conversations.ts`, `conversation-scope.ts`                   | Scope-first lexical/vector retrieval, private conversation history and source refs                | Task-specific candidate ranking and output; explicit source selection is still a separate unmerged workstream |
| `lib/memory/src/billing-quotas.ts`, `action-context.ts`                                   | User-action reservations, provider-attempt counters, account-wide generation slots                | Documented attribution for recurring runs and study follow-ups                                                |
| `packages/website/src/components/dashboard/assistance-panel.tsx`, `assistance-action.tsx` | Contextual launchers, preview/source inspector, keyboard/focus conventions                        | Workflow-specific inputs and result layouts; avoid one overloaded generic renderer                            |
| `lib/memory/src/exports.ts`, `cleanup.ts`, database recovery                              | Existing lifecycle and account export integration                                                 | Durable schedule/practice/review metadata policies and derived-result invalidation                            |

Current assistance has four kinds: filing, actions, digest and cleanup. Its selected
action sources are capped at six; visit digests page twenty changed notes and expose
twelve summary items. Those limits are not appropriate definitions of a weekly
review or a notebook-wide gap scan. Do not rename the visit digest or silently reuse
its checkpoint. Current summaries examine direct active members via fragments;
bounded retrieval cannot claim the same exhaustive coverage.

Related work: PR #131 supplies action allowances and owns migration **028**. PR #132
is an open file-import feature; merged #133 and open #134 concern admin/billing UI,
not prerequisites.
Explicit source selection, document Q&A and exact AI caching have separate plans;
none is a shipped dependency at this baseline. Reuse their public contracts if they
land first, otherwise build only the minimal shared scope/evidence support needed
here. Do not edit their worktrees or assume their provisional migration numbers.

## Shared service and data design

### Requests, evidence and results

1. Add strict discriminated workflow requests alongside existing assistance kinds.
   Each binds a stable operation UUID to kind, exact selected scope/versions,
   task inputs, format, size, date/window and policy version. Changed input requires
   a new operation; lost-response retries keep the original identity.
2. Store exact source dependencies and scope content versions separately from write
   targets. For notebook-wide negative findings and action reconciliation, depend on
   the whole examined scope, not just cited notes: an uncited new answer/completion
   can invalidate a result. Recheck membership, deletion, expiry, account/session,
   relevant preferences, provider profile, processing epoch and lease before dispatch,
   publication, every private read and any save.
3. Use shared typed evidence `{id, version, quote}` and validate verbatim quotations
   against supplied revisions. Claims must be supported, not just have valid-looking
   citations. A study question links its answer/rationale; a gap links the recorded
   question or insufficiently supported claim; a match links both problem and solution.
4. Return structured sections/items plus scope, eligible/examined/supplied/cited counts,
   truncated/partial reasons, frozen cutoff and remaining-work cursor. Distinguish
   selected scope from supplied evidence and actual citations. Derive coverage from
   service execution, never model self-report. "Examined" means processed by the
   workflow, not proof of human-level comprehension. Report incomplete indexing too.
5. Authorize/filter before retrieval scoring and source-body reads. No web tool,
   unrestricted library recall, profile memory or previous assistant answer may
   silently expand the scope. Treat source text and issue/agenda text as data, not
   tool instructions. Generated material is not independent corroboration of itself.
6. Keep new endpoints owner-website-session-only, like existing assistance. Scope
   predicates remain in shared service/database code. Any future agent/MCP exposure
   is a separate permission/contract decision, not an accidental consequence of reuse.

### Bounded processing and persistence

- Extend assistance request/state/result storage rather than add a parallel workflow
  engine. Introduce focused step modules under `lib/memory/src/` and shared schemas
  under `lib/shared/src/`; API wiring remains in `packages/api/src/`.
- Add separate schedule/occurrence and optional practice-state rows only where needed.
  Force tenant RLS, same-account references and least-privilege non-owner API/worker
  grants. Use additive forward migrations, selected against freshly fetched development;
  never claim 028/029 without checking merged and parallel work. Update readiness probes.
- Initial **proposed safety defaults**, to pin in shared configuration and tests before
  coding: up to twelve explicit notes or one notebook per run; 24,000 source characters
  per fragment; at most 128 notes and 24 model calls per pass; twelve output items
  (study: five to twenty cards/questions). Long individual notes must be chunked or
  rejected with a narrowing remedy, never silently clipped. Bound total tokens,
  serialized result bytes and wall-clock lifetime as well as counts. Tune these
  provisional values using the synthetic scale corpus; do not market them as capacity.
- Notebook membership itself is not capped at 128. Large scopes use resumable
  ID/revision checkpoints and explicit partial results/Continue. For problem retrieval,
  record candidate count, chosen evidence count and exclusions instead of claiming
  to have inspected every solution. Reject excess explicit pins rather than drop them.
- Freeze the relevant source/window manifest and scan boundary. If membership/content
  changes would alter a result's claim, mark it stale and offer Refresh, not a mixed
  snapshot. Weekly history additionally distinguishes window-end facts from current
  source availability; deletion/expiry always wins over historical rendering.
- Use existing durable leases, heartbeats, cancellation and provider/account limits;
  never hold a database lock during model calls. Resume checkpoints safely after
  broker outages/crashes. Reject late publication after cancellation, disable/re-enable,
  lost lease, suspension, source mutation or profile/restore cutover.
- Proposed generated-result retention: thirty days, or earlier source expiry/revocation.
  No stale content is served while cleanup waits. Preserve only bounded operational
  tombstones needed for replay/accounting after body expiry. Practice progress contains
  IDs/self-assessments, not unnecessary free-text answers. Confirm retention before
  implementation; account deletion removes access immediately, consistent with retained
  source/history policy. Restore invalidates generated bodies and pauses schedules.
- Account exports include authoritative schedules, reviewed saves and opted-in practice
  progress; derived previews/answer keys are regenerated, not restored as current truth.
  Notebook exports contain only metadata wholly inside that notebook. Add explicit
  export/recovery handling for every new durable record; no cross-notebook leakage.

### Preferences, usage and writes

- Give the five workflows independent on-demand AI preferences. Preserve existing
  disabled choices; new recurring schedules always start off. Do not enable connections,
  web research, email or paid providers when a user launches a workflow.
- Proposed accounting: one completed workflow result is one assistance action across
  fragments/continuations of the same frozen run. Poll/read/reveal/self-assess/save/Undo
  and same-operation retry do not add another AI action. A refreshed scope or new
  generated practice set is a new operation. Recommended first version generates
  explanations with the set, so Reveal/Explain needs no extra inference. If later
  implemented through Ask, a genuinely new follow-up counts one Ask reply, not both.
- Recurring generation must explicitly disclose and reserve one assistance action per
  occurrence under the same limits, never hide behind automatic-summary maintenance.
  On exhaustion, pause with the actual reset; do not consume retry attempts or backfill
  a storm of missed weeks. Preserve actual/uncertain provider-attempt evidence even
  when customer action reservations are released. No changes to prices or allowances.
- The separate proposed 0.2/1 cache-credit policy is not implemented here. Follow the
  current billing contract; integrate a common metering hook only if that policy lands.
- Saving creates an ordinary editable note/checklist only after a preview and explicit
  destination choice. Reuse `applyNoteChanges` for capacity/version/replay/Undo fences.
  No automatic task completion, decision replacement, source edits or solution execution.
  Reject unsupported Apply actions server-side for read-only workflow kinds; a valid
  generated result is not itself authorization to reuse another kind's write handler.

## Workflow-specific implementation

### 1. Weekly review

- Add a calendar-window request distinct from `visitId`. Default to the previous
  completed local week (Monday start); show and allow changing the exact range/timezone.
  Freeze half-open UTC instants plus account change-token bounds at the cutoff.
  Query token-ordered committed changes consistently; transaction timestamps alone
  must not let late commits disappear. Paging/retries never move the cutoff or visits.
- New ideas need a newly recorded source in the window; label newly filed pre-existing
  material separately rather than claim it was invented this week. Changed decisions
  require explicit change/replacement evidence and both relevant revisions, including
  linked cross-note decisions. A later timestamp alone does not establish supersession.
  Missing history produces an honest unavailable comparison, not an inferred change.
- Unfinished actions need a second scan of current eligible notes, including actions
  created before the week and unchanged during it. Reconcile explicit completion or
  cancellation across notes; ambiguous matches stay uncertain. Do not invent owners,
  deadlines or overdue status. Keep "changed this week" separate from "still open".
- Ship on-demand in-app first. Add optional weekly in-app recurrence after correctness
  and cost gates: user-selected day/time/IANA timezone, preview of next run, skip/disable,
  and one occurrence key per schedule/version/window. Materialize occurrences via the
  existing worker maintenance/admission path, then enrichment jobs. Handle DST gaps/
  repeats deterministically, downtime without unbounded catch-up, concurrent workers,
  rescheduling and account/notebook deletion. Recheck opt-in immediately before dispatch
  and publication. Execute via narrowly scoped current worker authority plus durable
  owner consent, never a stored browser token or an invented live session; define
  logout versus schedule-revocation behavior explicitly. No digest text in notifications,
  email or telemetry. Email is deferred.

**Acceptance:** visit acknowledgments cannot alter the week; unchanged open tasks
appear; completed/cancelled items do not; decision changes cite both sides; no-change
weeks are honest; two workers/retries create one visible occurrence and one action.
Partial scans show unresolved coverage rather than claiming all actions are known.

### 2. Meeting preparation

- Accept meeting title, bounded agenda/topic and optional time plus notes/notebook.
  Retrieve relevant recorded discussions, decisions and questions within that scope,
  then return a short brief grouped by those three headings. Each item links exact
  supporting revisions; include dates when recorded and mark conflicting positions.
- "Previous discussions" initially means discussions/minutes in saved notes. Private
  Ask transcripts are not indexed evidence by default; any later explicitly selected
  chat support needs turn-level provenance and deletion/revocation handling. Earlier
  assistant answers cannot prove that people agreed on a decision.
- Open questions distinguish explicit recorded questions from suggested agenda prompts.
  Suggestions are labelled as suggestions, not attributed to attendees. No attendees,
  commitments or calendar access are inferred. Missing evidence offers Add sources or
  a narrower topic, without silently widening search.

**Acceptance:** agenda relevance beats generic summaries; conflicting decisions stay
visible; recorded discussion dates are accurate; duplicate titles use IDs; no relevant
notes yields a limitation, not an invented briefing. Nothing is sent to participants.

### 3. Study mode

- Provide quiz, flashcard and explanation formats from selected saved source revisions.
  Build a coverage/topic outline, then a bounded practice set. Each item contains a
  prompt, answer, short explanation and source refs/quotes; optional multiple-choice
  distractors must be marked incorrect and their rationale grounded in the same notes.
- Keep answers concealed in the normal UI until Reveal; concealment is not a security
  boundary. Start with deterministic reveal/self-assessment (Again/Got it), accessible
  controls and resumable item position. No paid per-keystroke grading. Persist practice
  only on explicit choice, with idempotent versioned progress for cross-tab updates.
- Explanations may paraphrase supported concepts but must not invent missing premises.
  Contradictory notes produce a comparison or abstention, not a single false answer.
  An edited/deleted/expired source disables affected practice/reveals and offers a
  regenerated set. Do not rewrite selected notes or create cards as notes automatically.

**Acceptance:** every answer/explanation has validated support; no answer is shown
before Reveal in the ordinary flow; keyboard/touch reveal and progress resume work;
source invalidation clears offline/cached answers; empty/insufficient notes abstain.

### 4. Knowledge gaps

- First extract explicit questions, unresolved decisions and checkable claims with
  their source excerpts. Then search for answers/counterevidence elsewhere in the
  selected notebook before emitting a finding. Track the searched boundary and
  examined candidate manifest; a summary without a fact is not evidence of its absence.
- Separate **Recorded unanswered question**, **Claim with no supporting evidence found**,
  and **Suggested follow-up**. Say "No answer found in the reviewed notes"; note-local
  missing links alone do not prove a claim is false. External links are not fetched or
  declared invalid by default. Evidence elsewhere/outside scope may exist.
- A conflict is unresolved unless explicit resolution is recorded. Avoid generic
  completeness checklists unrelated to the notebook subject. Findings show why they
  matter, what was examined and an optional suggested question/evidence to add.
- Support reversible Dismiss/Not a gap keyed to issue plus source/scope policy versions;
  changed evidence reopens a finding. Save a follow-up only after review. Never fill a
  gap by generating a new "fact", and never start paid research without separate opt-in.

**Acceptance:** an answer in another notebook member suppresses/qualifies the finding;
scope changes invalidate negatives; partial scans cannot claim notebook-wide absence;
ambiguous evidence stays qualified; supporting sources are required for each finding.

### 5. Similar past problems

- Accept a bounded issue description, scope and optional selected current note. Use
  lexical/vector candidates with tenant/lifecycle/scope filters before scoring; avoid
  indexing the unsaved description as a note. Exclude the current issue itself and
  distinguish earlier records from undated material using recorded dates.
- Rerank candidate problem/solution evidence for shared symptoms, constraints, cause
  and outcome. Semantic similarity alone does not prove relevance or that a fix worked.
  Show a concise match reason, original solution, observed outcome, important differences
  and source links. Label proposed/untested solutions; do not call them successful fixes.
- Defaults stay notebook-local. An explicit "Search my other notebooks" request can
  broaden scope under current authorization; never broaden after a weak match without
  consent. Use keyword fallback with an honest reduced-retrieval label if embeddings
  are missing/disabled. Abstain on generic templates or superficial keyword overlap.

**Acceptance:** known earlier solved cases are retrieved; similar wording with different
constraints does not become a confident recommendation; failed/untested fixes stay
labelled; no-match results are useful and honest; no shell commands or edits are executed.

## Delivery sequence and exit gates

Each phase is an independently reviewable PR; phase A is a small vertical slice with
meeting preparation, not a speculative framework-only rewrite. No feature coding is
authorized by this proposal.

| Phase | Work                                                                                     | Dependency / exit gate                                                                            |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A     | Freeze contracts/budgets/retention; scope/evidence helpers, migrations and meeting brief | Resolve decisions below; regression-first authorization and citation cases plus actual UI journey |
| B     | Similar past problems and task-specific retrieval/reranking                              | A; labelled positive/negative corpus, scope-first retrieval and outcome labels                    |
| C     | On-demand weekly review, whole-scope action reconciliation and historical cutoff         | A; fixed-window/history/source lifecycle and carry-forward cases                                  |
| D     | Opt-in in-app weekly scheduling                                                          | C; explicit consent/accounting, two-worker/DST/outage tests and measured bounded cost             |
| E     | Study sets, reveal/self-assessment and optional progress                                 | A; source invalidation, hidden-answer UI and progress conflict tests                              |
| F     | Knowledge gaps, answer search and reviewed dismissals                                    | A/B; negative-evidence/coverage design qualified before any absence claims                        |

### Verification plan

- Write failing tests before each implementation slice. Extend existing assistance,
  conversation, jobs, action-quota, export/recovery and migration suites; add focused
  workflow and schedule suites rather than weaken existing assertions. Use fresh
  disposable PostgreSQL fixtures and real non-owner API/worker roles per
  [testing guidance](testing.md). Never reset retained data or broaden RLS.
- Test all five positive/empty/ambiguous cases; foreign/missing/deleted/archived/expired
  sources; direct versus descendant scope; duplicate titles; forged citations;
  injected instructions; edits/moves/completion during inference; session/account
  revocation; cancel/retry/lost responses; simultaneous last quota slot; lease expiry;
  provider/profile/preferences cutover; exports/restore and browser cache invalidation.
- Weekly-specific fixtures: DST transitions, week/month boundaries, late commits,
  unchanged old actions, cross-note completion, explicit replacement versus mere
  disagreement, missing historical revision, no-change weeks and schedule disable races.
- Use a versioned synthetic corpus with at least ten positive and ten adversarial/
  abstention cases per workflow, exact expected evidence and human-readable rubrics.
  Deterministic gates require zero cross-tenant/scope leaks, unsupported citation
  acceptance, implicit writes or duplicate visible operations/charges. Model evaluation
  additionally measures supported-claim precision, required-item recall, contradiction
  handling, correct abstention and false-gap/match rate. Proposed release threshold:
  at least 90% required items and no critical unsupported decision/solution/answer in
  the reviewed corpus; failures remain documented. Synthetic adapter success is not
  semantic-model quality. Live-model evaluation needs separate bounded paid-call consent.
- Benchmark 100/1,000/10,000/50,000-note synthetic scopes, long notes, many changes and
  foreground requests during worker load. Record SQL/model calls, prompt/result bytes,
  peak RSS, checkpoint/unchanged reuse, latency and cost estimates. Enforce hard work
  budgets and resumability; do not infer production throughput from local timings.
- UI: actual components and production CSS at 1440/390/320px in Chromium and supported
  iPhone/WebKit; keyboard/IME, focus return, screen-reader labels, touch, overflow,
  WCAG A/AA, pending/empty/partial/stale/quota/error/Retry, retained drafts, source
  inspector and account switching. Keep new UI lazy-loaded and within bundle budgets.
- Node 24 / pnpm 10.33.0: `pnpm lint`, `pnpm check-types`, `pnpm build`,
  `pnpm test:artifacts`, relevant/full backend tests, website lint/types/production
  build, bundle check and browser suites. Release/workflow inputs additionally require
  `node --test scripts/release/*.test.mjs` and workflow lint. Record exact heads,
  commands, counts, skips and limitations; require exact-head hosted CI Gate.

### Documentation, rollout and operations

- Extend [notebook assistance](../notebook-assistance.md), [workspace](../workspace.md),
  [API](../server.md), [jobs](../jobs.md), [billing](../billing.md),
  [deployment](../deploy.md), testing and recovery contracts as behavior lands. Audit
  claims about on-demand-only digests, six-note action limits, scope/coverage, settings,
  model use and exports. Preserve accurate historical delivery/release records.
- Add reviewed synthetic screenshots in `documentation/design/screenshots/notebook-workflows/`
  only once UI exists. Cover a weekly before/after, meeting brief, concealed/revealed
  study answer, qualified gap and problem comparison plus narrow/error/partial states.
  Record source/build/viewport; use at most four PR image previews per row. This
  planning-only change has no UI screenshots or feature verification claims.
- Ship feature-disabled additive schema, compatible API/worker, then website controls.
  Operator-applied migrations and production activation are separate approvals. Enable
  on-demand workflows individually, qualify grounding/cost/latency, then opt-in recurrence.
  Observe content-free per-kind success/stale/abstention, backlog, quota pauses and
  actual provider usage; never log note/agenda/question/answer text or private titles.
- Roll back by disabling admission/schedules and fencing publication, not reversing
  migrations or deleting authored notes. Preserve ordinary reads/edits/export and
  authoritative saves. Restore pauses recurrence until explicit re-enable.
- Each implementation PR targets protected development, assigned to `miniaxolotl`
  with one appropriate label, documentation and relevant evidence. No merge, release,
  paid inference or provider configuration is inferred. After confirmed authorized
  merge, remove only the clean stale task worktree once scoped helpers have detached;
  keep external plans and unrelated work. Production follows the frozen promotion path.

## Decisions to confirm before feature development

1. Accept notebook-local defaults, explicit broader search, saved-note discussions,
   read-only previews and reviewed saves; calendar/email integration and automatic
   grading/spaced repetition remain outside the first release.
2. Accept previous completed Monday-start week with visible timezone/range, then
   opt-in recurring **in-app** delivery; choose DST policy and skipped-run behavior.
3. Approve proposed source/model/result budgets, thirty-day derived retention and
   explicitly opted-in practice progress. Pin byte/token/time limits after measurement.
4. Approve one assistance action per completed run/occurrence and clarify continued
   frozen-run versus refreshed-scope charging. Do not import pending cache-credit policy.
5. Approve ordering A→B→C→D→E→F, evaluation thresholds and the source/negative-evidence
   contracts before treating "knowledge gaps" as a completeness feature.
