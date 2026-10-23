# Note and notebook connections

Open **Linked notes** and select a connection, or select an edge in the Notes
graph. Compact rows show the other note, category and a short reason; notebook
lists use the same layout. Endpoint lists start with five results and offer
**More connections**.

The compact **Connection** inspector shows the reason and links to both endpoints.
Expand **Supporting notes** for current excerpts and notebook coverage. Source
revision numbers are checked internally. Graph guides and the keyboard-accessible
**Connection list** are collapsed until opened.

- **Related** requires a concrete, useful link: for example the same recorded
  director/studio, base spirit, perfume brand/base notes, vacation destination,
  specific event or mechanism. One strong supported link is sufficient.
- **May conflict** identifies incompatible asserted claims about the same subject
  and property under overlapping conditions and time. Different films, recipes,
  products, trips, tastes or environments are not automatically conflicts.
  An edit timestamp alone does not establish which claim is correct.
- **Possible duplicate** identifies substantially equivalent information and
  explains differences. A single repeated sentence is insufficient.

Shared filing, note type, review format, ratings, “Rewatch”, generic praise or broad
topics are not enough, even together. Grove abstains when a specific link is not
supported; Related is not a fallback for pairs that are neither duplicate nor
conflicting. Attributes must be recorded in the original notes: Grove does not
look up missing directors, brands or ingredients or fill them from model knowledge.
Ingredient roles, negation, uncertainty and explicit supersession matter.

**Compare notes** opens a read-only comparison over the retained editor.
**Dismiss suggestion** removes the connection from both views. **Undo dismissal**
checks the assessment revision and review version; it cannot overwrite a newer
review or changed sources. Ask Grove's explicit preview/apply/undo flow remains
available for requested merges.

Automatic note comparisons stay within a notebook, or within Unfiled.
**Notebook options → Connected notebooks** and **Graph → Notebooks** explain
connections between collections. Only directly filed active, unexpired notes
participate; sub-notebooks are independent. Both notebook endpoints and every
cited note must be accessible. Parent grants do not include children.

Notebook explanations show **Shared thread** or **Shared context**, with a visible
**Partial coverage** qualifier when only some eligible notes were examined. The
expanded supporting notes show the number examined out of each notebook's total.
Broad context requires examining every eligible note, with at least two distinct
supporting contents covering half of each collection. Sampling a large notebook
therefore produces a qualified thread, even when discovery processed every note.
Duplicate text never inflates supporting-note counts. Dependencies are directional
only when explicitly evidenced; these are not whole-notebook conflict/duplicate badges.

## Processing and limits

Generation is asynchronous and respects independent note/notebook connection preferences and the shared daily
inference budget. Turning summaries off does not disable relationships or enqueue
replacement briefs. Generation-disabled installations expose a disabled state,
without inventing explanations for legacy enum-only labels.

- Note discovery combines exact matches, lexical matches and current same-scope
  vectors: at most eight new candidates, plus twenty existing pairs per scan.
  Lexical hints sample the whole note, retain short terms such as gin/rum and
  rerank at most 32 lexical results by distinguishing overlap rather than repeated
  template words. Lexical/vector rankings are interleaved within the same cap.
- Canonical ordered pairs coalesce reverse-direction jobs. Current unrelated
  results are cached too. Unchanged-source retries preserve dismissals.
- Notebook profiles scan 64 notes per job, persisting progress, a centroid, bounded
  lexical terms and twelve diverse representatives. All eligible notes participate
  in discovery; old/new notes also supplement assessment selection.
- Discovery walks other current notebook profiles in resumable batches of twenty,
  retaining the best five candidates across batches. Re-enabling organization
  resumes an interrupted discovery pass. Each completed profile proposes at most
  five candidate notebooks.
  Generation sees at most eight original notes / 12,000 characters per side.
- Grounding requires verbatim excerpts, exact versions and evidence from both
  endpoints. Generation must also identify one specific bridge, its endpoint
  facts/conditions and which excerpts support each side. Template/organizational/
  generic-topic bridges abstain. Malformed or unsupported citations remain errors.
  Internal support fields do not change the public connection contract or add a
  second model call. Deterministic validation establishes provenance and structure,
  not semantic truth: model judgments still need labelled quality evaluation.
- Reconciliation resumes at most 100 note scans and 20 notebook profiles per pass.
  It also schedules at most twenty old-policy pairs per level, skipping already
  queued/exhausted jobs so later pairs are not stranded behind the scan window.
  Failed jobs remain exhausted until explicit retry or a changed source snapshot;
  budgets defer until the next
  database day. Pair records are checked before spending another generation request.

Edits, moves, archive/restore and deletion change source identities. Notebook
content counters invalidate a claim even when an uncited note changes. The earliest
eligible expiry invalidates the notebook snapshot without requiring a write.
Publication also rechecks the job lease, committed provider profile and settings.
Deleted source text is scrubbed from notebook assessments and profiles immediately.
Pair review metadata remains separate from worker output.

## HTTP contract

`POST /v1/relationships/search` accepts:

```json
{ "level": "note", "endpointId": "NOTE_UUID", "limit": 30 }
```

Use `level: "notebook"` with a notebook ID. `connectionId` selects an inspector
record; `includeDismissed` permits reviewing/undoing a dismissed suggestion.
`endpointIds` (up to 100, including an empty array) returns only edges between
loaded endpoints. Signed cursors bind account, connection grant and filters.
Pages include `items`, `nextCursor` and `ready|pending|failed|disabled` status.
Restricted credentials receive no global processing counts or hidden endpoints.

`POST /v1/relationships/:level/:id/review` is owner-session-only:

```json
{
  "operationId": "OPERATION_UUID",
  "expectedRevision": "64_HEX_CHARACTERS",
  "expectedReviewVersion": 0,
  "dismissed": true
}
```

Undo sends `dismissed: false` with the returned review version and a new operation
ID. Replays reauthorize and validate current sources. Stale reviews return 409.
`POST /v1/relationships/:level/:endpointId/retry` retries processing for that
authorized endpoint. Retry preserves review decisions.

Legacy `enrichment.relationships` remains available (up to 30 current symmetric
links), now adding `connectionId` and `reason`. Detailed excerpts live in the
relationship read. Library/recall projections batch relationship reads rather than
fetching them per note. Graph pages show up to 100 loaded notes or notebooks and
make the selected coverage explicit. Account NDJSON export includes `type: "relationship"` records,
their level, assessments and review state.

## Migration and recovery

The original relationship tables require migration
`20261021_010_relationship_evidence`. The substantive-bridge policy adds **no new
SQL migration**. Its `relationships-v3-*` profile includes the explicit policy
version as well as provider profiles, invalidating old positives and abstentions.
Reconciliation rebuilds bounded derived assessments without rewriting notes;
graphs may temporarily show fewer connections while work respects daily budgets.

Pause/drain **all** old enrichment consumers, deploy matching API/worker code, then
resume dispatch. Do not run v2 and v3 workers together: separate claim profiles
prevent claiming each other's jobs, but an already-running old binary can still
write the canonical pair table. This is a coordinated cutover, not a database fence
against arbitrary old binaries. New readers hide old-policy results immediately
on fresh reads; already-open/offline browser snapshots retain normal refresh rules.
No bulk live backfill or production rollout is part of feature verification.

Pair IDs and unchanged-source dismissals survive reassessment. Assessment revisions
include profile identity, so an old inspector cannot review/undo a new-policy
assessment. Changed sources require fresh review. Cleanup uses the same substantive
duplicate/conflict policy and its own policy-versioned preview profile; unrelated
assistance kinds keep their cache identity. Existing reviewed Apply/Undo authority
is unchanged. See [rollout](deploy.md#connection-quality-policy-cutover).

Model reindexing clears profiles/scan checkpoints and schedules reconciliation;
pair reviews survive. Recovery reconciliation copies current authoritative
review decisions, increments review versions, invalidates explanations and clears
old operations/jobs before rebuilding. Account deletion cascades pair/profile
records. Explicit model-data reset clears notebook artifacts with the notes.

For application rollback, pause consumers, disable organization, and deploy the
previous application without reversing the migration. Retain the tables and
review metadata. Re-enable only with compatible workers/API. Follow
[deployment guidance](deploy.md) and the protected release process.

## Quality evaluation

`tests/fixtures/relationship-quality.ts` contains an explicitly labelled synthetic corpus:
paraphrases, partial overlap, dates, negation, changed decisions, environments,
uncertainty, prompt injection, mixed claims, notebook coverage and empty notebooks,
plus film/cocktail/perfume/journal hard positives and negatives. Development and
held-out cases are marked separately; the original cases belong to development.
Run it with a server-side generation credential:

```sh
GENERATION_API_KEY=... pnpm exec tsx scripts/testing/relationships.ts --live
# Explicitly cap a repeated run, or select --split=development / --split=held-out:
GENERATION_API_KEY=... pnpm exec tsx scripts/testing/relationships.ts --live --repeat=3 --max-calls=114
```

The runner makes one request per case/repetition and refuses selections above the
explicit cap (50 default, 200 maximum; at most three repetitions). Provider/model
can be selected with `GENERATION_PROVIDER`, `GENERATION_URL`, `GENERATION_MODEL`.
It prints synthetic reasons/excerpts, per-label precision/recall, domain results,
token usage and mismatches. Transport/schema failures remain separate; repeated
runs are not independent labelled examples. Supplied-pair evaluation does not
measure retrieval recall. Database tests separately exercise bounded text-only
discovery amid distractors. Review explanation support, not only label matches.
See [quality evidence and limits](development/connection-quality-results.md).
