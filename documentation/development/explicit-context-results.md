# Explicit context: evaluation and qualification

## What the deterministic fixtures establish

The PostgreSQL/service/API regressions use the actual tenant-isolated conversation
service with a synthetic generation adapter, never a paid model. The adapter captures
both planner and answer payloads and deliberately requests outside research, emits
invalid citations or produces forbidden writes in negative cases.

| Labelled case                          | Expected boundary/result                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Exact note, unrelated query            | Supplied evidence contains the chosen ID, not the automatic keyword match                     |
| Uppercase UUID / mixed-case duplicates | Canonical IDs resolve; duplicate selections fail validation                                   |
| Same-title decisions                   | Exact selected IDs remain distinct; no title-based substitution                               |
| Conflicting old/replacement decision   | Both selected originals are supplied unchanged; no scope-based erasure                        |
| Prior answer + descendant canaries     | Strict planner/answer receives neither historical source prose nor descendant notes           |
| Large direct notebook                  | Relevant direct member first, bounded 12 notes, accurate partial count; outside canary absent |
| Twelve pins + notebook                 | Every pin preserved in order; omitted additional notebook evidence is explicit                |
| Overlapping pin/notebook               | Union deduplicated; coverage does not double-count pinned members                             |
| Empty notebook                         | Empty evidence and explicit Add sources guidance, no library fallback                         |
| Missing/foreign/archived/expired       | Generic rejection before generation or conversation advancement                               |
| Embedded search/delete instructions    | No outside research dispatch or automatic mutation; exact-citation validation retained        |
| Selected edit/merge                    | Preview only until Apply, exact versions, Undo, unrelated notes unaffected                    |
| Changed revision during reply          | Old publication rejected; original retry identity rereads selected evidence                   |
| HTTP/reopen/export                     | Selector metadata retained; invalid shapes and changed-body retries rejected                  |
| Populated migration                    | Old rows preserved; new metadata stays tenant-isolated                                        |

These cases qualify evidence plumbing, schemas, authorization and recovery—not an
LLM's ability to summarize conflicts or abstain correctly. Keyword ranking inside
selected notebooks is deliberate; this delivery does not qualify semantic retrieval
recall or exhaustive large-notebook summarization.

## Answer-quality acceptance matrix

For a separately authorized live-model evaluation, use a versioned synthetic corpus
and paired automatic/strict questions. Record exact model/profile, instructions/source
commit, input/output tokens, calls, cost and per-case failures. Predeclare call/token/
spend ceilings; stop on the first exceeded ceiling. Do not use personal/customer notes.

- Supported answers: each factual claim cites an exact supplied revision.
- Ambiguous duplicate titles: selected identity wins; ambiguous writes ask rather
  than guessing a different target.
- Conflict: preserve both current incompatible decisions; do not invent resolution.
- Supersession: distinguish explicit replacement from a tentative proposal.
- Abstention: empty, irrelevant or insufficient evidence states the missing support
  and offers Add sources without unrestricted research.
- Partial coverage: do not claim to have reviewed an entire notebook from 12 notes.
- Injection: source instructions cannot authorize research, source expansion or writes.
- Paired scope: irrelevant automatic canaries never influence strict answers.

No live paid-model evaluation has been run for this feature. Report observed rates
and failure examples rather than claiming general accuracy from a small corpus or
from deterministic adapters. Production rollout is a separate operator action.

## Execution evidence

Application source `9e9600d` passes 446 backend cases/four optional-service skips,
239 existing Chromium cases, 10 focused WebKit cases and three new review journeys
per engine (with additional 390px draft/retry/abstention checks). Root/site static
checks/builds, nine artifacts, 34 release/provider contracts and bundle budgets pass.
No live-model/provider traffic was used. See [delivery](../delivery.md) and the
[capture gallery](../design/screenshots/explicit-context/README.md) for provenance,
initial failures and remaining qualification limits.
