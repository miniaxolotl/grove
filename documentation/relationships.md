# Note and notebook connections

Open **Linked notes → Why this connection?** in a note, or select an edge in
the Notes graph. Both views use the same assessment, reason and current excerpts.

- **Related** identifies useful additional context about a specific subject.
- **May conflict** identifies incompatible claims under the same conditions.
  An edit timestamp alone does not establish which claim is correct.
- **Possible duplicate** identifies substantially equivalent information and
  explains differences. A single repeated sentence is insufficient.

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

Notebook explanations show **a shared thread** or **broad shared context**, plus
the number of original notes examined out of each notebook's eligible total.
Broad context requires examining every eligible note, with at least two distinct
supporting contents covering half of each collection. Sampling a large notebook
therefore produces a qualified thread, even when discovery processed every note.
Duplicate text never inflates supporting-note counts. Dependencies are directional
only when explicitly evidenced; these are not whole-notebook conflict/duplicate badges.

## Processing and limits

Generation is asynchronous and respects the organization setting and shared daily
inference budget. Turning summaries off does not disable relationships or enqueue
replacement briefs. Generation-disabled installations expose a disabled state,
without inventing explanations for legacy enum-only labels.

- Note discovery combines exact matches, lexical matches and current same-scope
  vectors: at most eight new candidates, plus twenty existing pairs per scan.
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
  endpoints. Deterministic validation establishes provenance, not semantic truth.
- Reconciliation resumes at most 100 note scans and 20 notebook profiles per pass.
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

Apply forward migration `20261021_010_relationship_evidence` with the database
owner while API/worker consumers are paused, then deploy the matching API, worker
and website. Do not mix old consumers with the new job kinds. The new worker uses
a separate `relationships-v2-*` profile for claim/outbox dispatch; old workers
cannot select that profile. Reconciliation supplies a bounded, resumable backfill
without rewriting notes. No bulk live backfill is part of feature verification.

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
uncertainty, prompt injection, mixed claims, notebook coverage and empty notebooks.
Run it with a server-side generation credential:

```sh
GENERATION_API_KEY=... pnpm exec tsx scripts/testing/relationships.ts --live
```

The runner makes at most one request per case and prints synthetic reasons,
validated excerpts, classifications and mismatches. Transport failures are not
model-quality results. Review every mismatch separately from deterministic
database, grounding and browser tests.
