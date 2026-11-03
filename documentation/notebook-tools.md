# Workbench

Open **Workbench** in the workspace, Ask Grove, or the command palette. Note actions,
the selected-note toolbar and Notebook options open the same chooser with those
sources selected. Each tool has a separate, initially off preference under
**Settings → AI preferences → Workbench**; the form also offers explicit opt-in.
Opening or editing a tool does not start generation.

Choose a workflow from the full-row directory, set its focus, select sources, then
review and create. Output detail is optional; the default is Standard. Switching
back to Workbench retains each workflow's draft and returns keyboard focus to its
launcher. Drafts remain local to the open Workbench, not a cross-session history.
The unrelated **Tools** menu in Ask still controls web search and chat actions.

| Tool                | Input                                                       | Review                                                                                                                   |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Weekly review       | Monday week start and timezone                              | New ideas, historical decision changes and unfinished actions, including older tasks                                     |
| Create a brief      | Any goal; optional title/audience                           | Source-linked sections adapted to research, planning, handoffs, appointments or other goals—not a fixed meeting template |
| Study notes         | Optional topic, quiz/flashcards/explanations and item count | Supported answers and explanations; Reveal and temporary Again/Got it practice                                           |
| Find knowledge gaps | Optional focus                                              | Recorded questions/claims after scoped answer lookup; evidence not found is not proof of absence                         |
| Find past solutions | A situation or problem                                      | Earlier approaches, similarities/differences and recorded tested/proposed/failed/unknown outcomes                        |

## Choose sources deliberately

Use exact selected notes, one or more selected notebooks, explicitly included
sub-notebooks, or **My active library** (including Unfiled). Archived, deleted,
expired, inactive-notebook and other-account notes are excluded. Descendants are
never inferred. Selected notes pin every chosen ID/version; a stale pin is an error,
not permission to silently omit it or search elsewhere.

Filter notebooks by name without changing selected notebooks, including selections
outside the filter. Selection counts and the scope summary stay explicit. Selected
note titles are retained when you search or move to another source page; revision
links remain available. The create action explains missing focus, sources or opt-in.

Scope size is distinct from the evidence budget. Each main batch supplies up to
twelve note bodies/24,000 characters (gap candidates use six/10,000; weekly current
sources use twelve/12,000 to reserve historical capacity). Metadata pagination is
bounded to128 candidates at a time. **Review more sources** resumes the same frozen
operation; supplied/examined/cited and partial coverage remain visible. It is bounded
lexical retrieval, not a promise of exhaustive semantic relevance or large-scale speed.
Results retain bounded output collections, so examining more notes does not promise
every finding is included in the output.

Gap candidates and weekly unfinished actions receive a second scoped lookup for
answers or completion/cancellation evidence. The combined model evidence stays
within24,000 characters; lookup coverage may remain partial. Continuations recheck
earlier candidates so removed findings do not reappear through append-only merging.
Weekly decision changes require both historical revisions; unavailable/oversized
history is disclosed instead of inferred from a current note. Windows use calendar
timezone/DST boundaries and freeze at request time; visits do not affect them.
Recurring generation/email/calendar delivery is not implemented or silently enabled.

## Review, save and recover

Exact quotations and revision links support inspection, not a guarantee that a model
interprets them correctly. No web, calendar, messages, chat history or external tools
are consulted. Source text and task goals are untrusted data, not instructions to
change authority. Empty results abstain rather than inventing content.

**Save result** creates ordinary editable notes in the reviewed destination, with
sources and coverage warnings; original notes are unchanged. Long results split only
at complete blocks. All created-note links remain available, and one atomic **Undo**
archives those notes, refusing to overwrite later edits. Study saves include answer
keys/explanations; local answers/practice are neither grades nor persisted progress.
Quiz answers remain visible beside revealed source-supported answers. Reveal/Hide
keeps keyboard focus, and Again/Got it shows pressed state and local practice counts.
Hiding an answer retains your draft and self-assessment; it does not grade or reset it.
Confirmed saves show **Saved to your notes**, note links and **Undo**. An unconfirmed
save offers **Retry save**, retaining the exact destination and operation identity.

**Cancel generation** fences publication even if an already-dispatched provider
finishes. Closing a pending preview alone does not cancel it. **Edit tool inputs**
retains the form and exact scope. Uncertain enqueue/Continue/Save requests preserve
their original operation identities and block conflicting edits until resolved.
Refresh intentionally starts a new operation against current revisions.

One frozen result uses one assistance action, including resumable batches. Reads,
Reveal/practice, polling, Save/Undo and replay add no actions. Actual model attempts
remain separately metered; retries can consume provider budget. A run reserves
capacity for at most24 successful staged calls (two for gap/weekly batches), with
existing bounded transport retries/provider limits still applying. Empty evidence
requires no inference. Cancellation/failure releases an unsettled action, not prior
completed usage or provider-cost evidence. No prices/wallet/activation change.

## API and retention

Owner-session-only, private/no-store assistance routes accept the canonical kinds
`weekly_review`, `preparation`, `study`, `knowledge_gaps`, `similar_problems`:

```json
{
  "id": "stable-operation-uuid",
  "kind": "preparation",
  "goal": "Prepare context for a research handoff",
  "scope": {
    "kind": "notebooks",
    "ids": ["notebook-uuid"],
    "includeDescendants": false
  },
  "detail": "standard"
}
```

- Other scopes: `{kind:"notes",sources:[{id,version}]}` or `{kind:"library"}`.
- `POST /v1/assistance` binds the strict input fingerprint; changed input needs a
  new UUID. `GET /v1/assistance/:id` returns typed results and coverage.
- `POST /v1/assistance/:id/continue` accepts strict `{expectedVersion}`, resumes a
  ready partial result and idempotently replays an uncertain continuation.
- `cancel` accepts strict `{expectedVersion}` for pending work; `apply` accepts
  `{expectedVersion,destinationProjectId?}`; `undo` uses the existing version fence.
- Keys, OAuth agents/public shares cannot use these routes; no new MCP tool exists.

Scope membership/content/catalog, source revisions, account authority, preference
generations, profiles, leases and expiry are checked before dispatch/publication and
on read/save. New answers, even uncited changes, invalidate affected scope results.
Derived request/state/results expire after30 days or earlier scope source expiry.
Maintenance redacts only derived bodies, retaining replay/applied references and
authored source/history/provider evidence. Saved notes follow ordinary retention.

Migration `20261025_033_notebook_tools` adds five default-off preferences, new
assistance kinds/index and a worker-only cleanup scheduler. Legacy meeting requests/schema/data remain
compatible; their specialized launcher is replaced by the general Workbench UI.
The `/app/tools` route, internal identifiers and API/preference names are unchanged.

## Rollout and recovery

Follow the [owner schema procedure](operations/schema.md) with the admitted source,
actual applied history and a verified retained backup. The migration registry appends
`20261025_031_meeting_preparation` and then `20261025_033_notebook_tools` after the
existing notebook-order migration. Their original full names remain stable; their
numeric prefixes are not the application order and do not replace the distinct
document-import or AI-cache migrations. Never rename or reset applied migrations.

Drain old workers, apply pending forward migrations and deploy matching API/worker
before the website. All five preferences start off without queuing inference.
Enable tools explicitly for a synthetic internal account and verify scope, continuation,
citations, cancellation, expiry, source preservation and reviewed multi-note Save/Undo.
Check one assistance action across batches separately from actual provider attempts.
Restore invalidates previews. Rollback disables admission/preferences and drains jobs
while retaining additive schema, authored notes, legacy requests and usage evidence.
Live-model grounding, latency/cost, large-library relevance and physical-device
acceptance require separate qualification; recurring delivery is not enabled.

## Verification

Use [disposable PostgreSQL and browser setup](development/testing.md) with non-owner
API/worker roles and actual production CSS:

```sh
pnpm exec tsx --test tests/src/preparation-workflow.test.ts tests/src/notebook-tools-migration.test.ts tests/src/meeting-preparation.test.ts tests/src/meeting-migration.test.ts
pnpm --filter website exec playwright test tests/meeting-preparation.spec.ts tests/models.spec.ts tests/assistance.spec.ts
pnpm --filter website exec playwright test --config playwright.meeting-webkit.config.ts
```

Service cases cover explicit scopes/pins and descendants, bounded continuation/replay,
flexible briefs, supported study answers, gap answer lookup, historical weekly pairs,
cross-note action completion, qualified past outcomes, DST windows, source/preference/
cancel races, citations, expiry and long-result atomic Save/Undo. Upgrade cases retain
legacy/provider data and opt-outs, forced RLS and worker-only scheduling.

The meeting-named browser suite covers the current Create a brief flow. For all-five
UI→HTTP API→PostgreSQL/worker journeys use `tests/src/fixtures/meeting-api.ts` with
task-owned `MEETING_API_PORT`, `MEETING_SITE_URL` and `MEETING_FIXTURE_FILE`, plus
matching dashboard fixture ports. Verify 1440/390/320px and short/enlarged-text views,
keyboard Back focus, per-tool drafts, filtered notebook selections, retained note
titles, Reveal/Hide/practice, uncertain requests, Save/Undo, sources and unchanged
originals. Deterministic adapters establish wiring, not live-model quality.
See [reviewed captures](design/screenshots/notebook-tools/README.md).
