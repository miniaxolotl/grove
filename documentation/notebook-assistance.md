# Notebook assistance

Notebook summaries adapt to the notes' subject. Filing, action lists, visit digests
and cleanup run only when requested. Each has an independent AI preference;
automatic note/notebook connections can stay off.

The [Tools section](notebook-tools.md) groups five separately opted-in, on-demand
workflows: Weekly review, Create a brief, Study notes, Find knowledge gaps and Find
past solutions. They support broad explicit note/notebook/library scopes, exact
sources, bounded continuation and reviewed Save/Undo. General briefs replace the
meeting-specific launcher; legacy031 requests remain compatible. The visit digest
below remains separate from calendar-week review, and recurrence is not enabled.

The [original proposal](development/notebook-workflows.md) retains the phased
roadmap and future qualification work; the current Tools contract governs source
behavior.

## In the workspace

- **Summary** shows a compact overview, source revisions and examined/cited counts.
  Refresh uses the existing summary control. All directly filed active notes are
  examined; the short overview represents a selection of their facts.
- **Move → Suggest a notebook** checks an unfiled note against existing notebook
  profiles. A clear match shows its name, reason and original excerpts. **Move here**
  applies the preview; **Undo** restores the previous filing. Weak matches abstain.
- **Extract action list** is available from a note or a selection of up to six notes.
  Review up to twelve recorded actions, edit their wording and save an ordinary
  Markdown checklist. Unchanged items link to exact sources; edited items are marked.
- **Notebook options → Since your last visit** shows a fixed window of changes.
  The first visit establishes a baseline. Later visits acknowledge a successfully
  loaded, visible notebook; prefetches and background reads do not advance it.
  Digests group edits by note, show before/after revisions and page twenty notes
  at a time. Deleted or expired text is replaced by unavailable-source metadata.
- **Notebook options → Review notebook** checks up to 128 notes and 24 candidate
  pairs per pass. Coverage makes a partial scan explicit. **Keep both** is reversible;
  **Combine** previews both originals and archives the other note. **Update note**
  uses explicit replacement evidence. Age alone cannot establish supersession.
  Duplicate/conflict suggestions use the same [substantive criteria](relationships.md)
  as connections: shared templates/ratings or different subjects are insufficient.
  Generation supplies a concrete, both-sided evidence bridge; weak overlap abstains
  without proposing a merge. Cleanup policy changes invalidate old ready previews,
  without changing action/filing/digest profiles or granting automatic write access.

All mutations check the source versions again. A changed source requires a refreshed
preview. Retried Apply requests return their original result; Undo refuses to
overwrite later edits and remains available when the feature is switched off.
Sub-notebooks are separate scopes. Source-revision views are read-only and recheck
current authorization, deletion and expiry, including revisions older than the
ordinary hundred-entry history page.

## API and persistence

The new assistance and visit routes require the owning website session. API keys,
OAuth agents and public shares cannot access them. Bodies use the schemas in
`lib/shared/src/assistance.ts`; responses use the standard private API envelope.

| Route                                     | Input                                                                |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `POST /v1/assistance`                     | Stable UUID `id`, `kind`, and its source/scope fields                |
| `GET /v1/assistance/:id`                  | Preview status, coverage, evidence and applied refs                  |
| `POST /v1/assistance/:id/apply`           | `expectedVersion`, optional action edits or cleanup candidate/action |
| `POST /v1/assistance/:id/undo`            | Applied `expectedVersion`                                            |
| `POST /v1/assistance/:id/review`          | `candidate`, review `expectedVersion`, `dismissed`                   |
| `POST /v1/notebook-visits`                | Stable UUID `id`, `projectId`, snapshot `from` and `token`           |
| `GET /v1/memories/:id/revisions/:version` | Exact source revision within current `memory:read` scope             |

Filing takes one unfiled `{id,version}` source; actions take one to six and an
explicit destination `projectId` (nullable). Cleanup takes a notebook `projectId`.
Digest takes a `visitId` and optional `after` note UUID. A request ID cannot be reused
with different input. Apply also binds the exact submitted edits to its replay ID.

Migration 015 adds independent preferences, RLS-protected previews/reviews, summary
checkpoints and a metadata-only change ledger. Existing choices inherit once from
titles/tags, Ask Grove, notebook summaries and linked notes respectively. Legacy
grouped preference writes retain their previous membership.

Notebook summary leaves contain at most eight notes/24,000 source characters;
UUID partitions and bounded reductions reuse unchanged subtrees. Source mutations
remove the affected leaf and its ancestors in the same transaction; cached subtrees
also carry the earliest source expiry. Assistance uses
the existing enrichment lane, provider/account limits, daily budgets, renewed leases
and processing epochs. Profile/settings/source checks fence publication after
inference. Profiles and candidate discovery are reused from connections, independently
of their enabled preference. Supporting reads are distinct from note-write targets.

Account-row locks serialize ledger tokens with commits. Visits freeze both token
boundaries and acknowledge monotonically, so late acknowledgments cannot move the
checkpoint backward. Due expiries are recorded in batches of 200 before a visible
snapshot can advance. An indexed pending-expiry table avoids scanning source text.

Account exports include paged review decisions, visit/checkpoint metadata and applied
operation references. Cross-notebook operation/review metadata is account-export-only;
notebook exports include only their visit/checkpoint records. Generated previews and
Undo text are excluded. Changes to these durable records invalidate older exports.
Recovery preserves authoritative review decisions and applied-operation tombstones,
invalidates preview/Undo content, and resets visit baselines for the restored source
snapshot. Retained original notes and revisions follow the existing deletion contract.

## Verification

`notebook-summaries.test.ts`, `notebook-assistance.test.ts` and
`assistance-migration.test.ts` use fresh PostgreSQL databases and real non-owner
roles. They cover populated 014→015 upgrades, RLS, replay, stale sources/preferences,
historical evidence, fragment reuse, invalid quotations/supersession, expiry, exports
and recovery. `assistance.spec.ts` exercises the real components, keyboard/focus,
source links, lost-response retries and narrow layouts in Chromium/WebKit.

With the disposable database URLs from [testing](development/testing.md):

```sh
pnpm exec tsx scripts/testing/notebook-assistance.ts --benchmark
GENERATION_API_KEY=… pnpm exec tsx scripts/testing/notebook-assistance.ts --live
```

The benchmark uses synthetic inference and 100/1,000/10,000 notes. It measures initial,
unchanged and one-edit passes, call/query counts, source characters, maximum prompt
size and process RSS. These are orchestration measurements, not provider latency or
semantic-quality results. The live runner uses only labelled synthetic fixtures
from `tests/fixtures/assistance-quality.ts`. Inspect every output against its rubric:
supported summary themes, filing precision/abstention, action precision/recall,
both-sided changed decisions and cleanup false positives. Blanket abstention does
not meet positive cases. Record actual provider/profile and results in delivery evidence.

See the [recorded quality and scale results](development/notebook-assistance-results.md)
and [reviewed desktop/mobile captures](design/screenshots/notebook-assistance/README.md).
