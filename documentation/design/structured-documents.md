# Structured documents and targeted editing

**Status: integration proposed; initial P0 core implemented.** The pure
[document core](../development/document-core.md) supplies lossless snapshots,
guarded patches and deterministic diff data, but no product path uses it yet.
This remains an implementation design, not a description of available tools.
The baseline is v1.11.14. Current writing and
editing behavior remains in [workspace](../workspace.md),
[agent note writing](../agent-note-writing.md) and [API contracts](../server.md).

## Outcome and scope

Turn a note from an undifferentiated Markdown string into a versioned document
with identifiable blocks and explicit changes. A person or agent can change a
sentence, paragraph or section without resubmitting unrelated text. Review shows
what was added, removed, moved or reformatted, not just two full documents.

Use the same contract in the browser, HTTP API, remote MCP, stdio bridge and
OpenCode/Claude/Codex plugins. Preserve plain Markdown reading/export and all
existing tenant, lifecycle, attachment, review and retry protections.

Design for later shared documents, but do not add invitations, collaborator roles,
public editing, presence/cursors, offline collaboration or a CRDT server in this
workstream. Existing public links remain read-only. Safe concurrent requests from
today's browser tabs and connected agents are in scope; multi-person authorization
is a separate project.

## Current state and gaps

| Area         | Current implementation                                                | Required change                                                            |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Storage      | `memories.content` text; `memory_revisions` content/source snapshots  | Versioned structured body, stable identities and explicit change records   |
| Updates      | `update_memory` preserves omitted fields but replaces supplied body   | Passage/block operations validated against exact observed state            |
| Concurrency  | Whole-note expected version; operation-ID retry fingerprint           | Retain this safety, then permit only provably disjoint changes             |
| Browser      | CodeMirror, Markdown source, 450ms autosave and session-memory drafts | Translate transactions to targeted operations without resetting the editor |
| Review       | `RevisionCompare` renders complete before/after Markdown              | Reusable structural/text diff, with complete-source fallback               |
| AI changes   | Reviewed proposals/Apply/Undo still write complete content            | Scoped patch proposals; shared validation and guarded inverse operations   |
| Integrations | Shared tool catalog and generated native-agent guidance               | Additive tool support and capability detection across every transport      |

Primary source touchpoints:

- Contracts: `lib/shared/src/contracts.ts`, `memory-tools.ts`, `note-writing.ts`.
- Writes/history: `lib/memory/src/index.ts`, `note-changes.ts`,
  `conversation-actions.ts`, conversation/assistance proposal schemas.
- Persistence: `lib/database/src/migrations.ts`, models, soft-deletion/media guards.
- Transport: `lib/memory/src/tools.ts`, `packages/api/src/app.ts`,
  `packages/mcp/src/bridge.ts`, `lib/integration-core/src/index.ts`.
- Browser: `markdown-editor.tsx`, `memory-editor.tsx`, `note-drafts.tsx`,
  `revision-compare.tsx`, history, Ask and assistance under
  `packages/website/src/components/dashboard/`; shared API/cache modules.

The current source and schema impose a 6,000-character body limit. Keep it unless
a separate capacity decision changes every relevant contract. Structured storage
does not implicitly authorize larger notes, new formatting or a new editor.

## Non-negotiable invariants

1. An edit changes only its declared target. Untouched source, whitespace, task
   states, links, literal examples and `grove-media:` references remain identical.
2. Stable node identity is independent of position, text, heading name and actor.
   IDs are scoped to a document; never resolve a node from another note.
3. Authorization, active lifecycle, source dependencies and version/preconditions
   are checked at commit, not only at preview. A citation never grants write access.
4. A batch commits atomically as one new revision with audit and durable work
   publication; an invalid operation cannot leave a partially edited document.
5. Retry the same immutable operation ID/payload after uncertain acceptance.
   Changed payloads require a new ID; a lost response must not duplicate a change.
6. No silent last-writer-wins, fuzzy replacement or regeneration of the whole note
   to resolve ambiguity. Conflicts preserve both the saved content and local draft.
7. Preview is not Apply; queue acceptance is not completion. Undo creates a guarded
   new change and cannot restore deleted evidence or overwrite later edits.

## Recommended data model

### A lossless structured body

Introduce a shared pure document module under `lib/` following existing package
conventions; keep public validation/types in `lib/shared`. Prototype package
boundaries before adding a dependency. Prefer existing CommonMark/GFM parsers.

The document envelope contains `schemaVersion`, note identity, current revision,
ordered block nodes and a content hash. Each node has an immutable ID and a kind,
such as heading, paragraph, list, quote, code, table or opaque source. Nodes retain
exact Markdown source, including separators/line endings. Where nodes contain
children, define explicit ownership of delimiters and gaps: source must be owned
once, not independently editable in both parent and child.

Start with top-level semantic blocks; nested compound blocks can be conservative
atomic targets until the lossless nested adapter is proven. This limitation must
be exposed to clients. Inline edits address exact ranges within the owning source
block, not a second independently editable rich-text representation. Markdown
syntax recognition is derived; supported GFM rendering does not expand.

`serialize(parse(source)) === source` is a release gate. Preserve unrecognized
syntax as opaque source, never normalize it away. Define offsets as UTF-16 code
units for browser compatibility and reject boundaries splitting surrogate pairs;
also test emoji, combining marks and IME composition. Source offsets are valid
only against the matching block hash/revision, never as global durable anchors.

Preserve node IDs across edits/moves using known operations, not fresh IDs on every
parse. Split retains one ID and creates another; merge retains a designated ID;
deleted IDs are not reassigned. Legacy replacement matching preserves only
unambiguous unchanged IDs and records uncertainty rather than matching repeated
paragraphs by guess. Heading URLs retain their existing compatibility behavior;
stable document IDs do not silently redefine public/private section links.

### Persistence and revisions

Recommended initial storage is a document JSONB snapshot attached to each current
note and new authored revision, plus an append-only change-batch table. This fits
the existing bounded note size and atomic write path; per-node SQL rows and
fractional-position indexes are unnecessary until measurements justify them.

- Keep the note ID, notebook, kind, provenance, retention and lifecycle envelope.
- Keep existing note version as the authoritative mutation sequence. Store the
  submitted base and actual committed parent revision; metadata-only changes are
  labelled separately and do not fabricate a body diff.
- Store schema version, document hash, validated operations, changed node IDs,
  trusted principal/connection identity, source channel and operation ID.
  Client-supplied `source.agent` is not proof of human authorship.
- Keep `content` as a Markdown compatibility/search projection. Once a note is
  converted, the document owns content; both are updated in one transaction.
  Reject divergence and audit every direct content writer before enabling reads.
- New revision snapshots preserve node identity and reproducible diffs. Existing
  historical rows remain immutable: legacy comparisons can use a lossless text
  diff without invented node lineage or historical actor attribution.

New tables need tenant-qualified keys, forced RLS, lifecycle visibility matching
their parent note and narrow runtime/worker grants. Review/operation payloads can
contain private removed text: apply retained-history policies, export controls,
expiry and account deletion visibility, not generic log retention. Do not send
document text, patches or diffs into telemetry.

## Targeted edit protocol

### Operations

Define a strict, versioned discriminated union, initially:

- `replace_text`: node ID, exact source range, expected block hash/old text and new
  text; insert/delete text are bounded special cases of this operation.
- `insert_block`: new node plus expected parent and adjacent-node anchor state.
- `delete_block`: exact node/subtree and expected hash/parent state.
- `move_block`: exact node plus guarded source/destination anchors; reject cycles.
- `split_block` / `merge_blocks`: explicit identities and delimiter ownership,
  introduced only after their preservation tests pass.

Formatting edits use these same source operations. Do not introduce generic
arbitrary JSON-path mutation, regex/global replace, silent first-match selection,
or an implicit replace-document fallback. A requested whole-document rewrite is
a distinct, explicitly labelled replacement, not a targeted edit.

Every batch includes note ID, base revision, operation ID and bounded operations.
Bind the editable target set to the user's selected passage/blocks or explicit
requested scope, independently of the model's proposed operations. Reject patches
outside that set; reading the surrounding note does not authorize editing it.
When the requested target is ambiguous, clarify rather than widening the scope.
Specify whether operations address the sequential intermediate state (recommended)
and validate all of them before commit. Bound operation count, inserted bytes,
document size, nesting, diff cost and response size; final limits are an explicit
P0 decision, not unbounded arrays. Reject empty/no-op batches without a new revision.

### Read, preview, apply, compare

Proposed names below are illustrative and unavailable today:

| Operation                  | Purpose                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `get_memory_document`      | Authorized snapshot or bounded block selection with real IDs, revision, hashes and completeness information                     |
| `preview_memory_patch`     | Validate exact targets and return a deterministic diff, affected blocks and opaque review identifier; no authored-content write |
| `apply_memory_patch`       | Commit the exact reviewed patch with operation ID and still-valid review/version/preconditions                                  |
| `compare_memory_revisions` | Authorized bounded diff between two saved revisions, including legacy history                                                   |

Implement service methods once and expose through the shared HTTP/MCP catalog;
the web adapter must not implement a weaker parallel patch engine. Read-only
operations require existing read capability; preview/apply require the appropriate
existing read/write authorization. Add schema/capability negotiation without
assuming the current `apiVersion: 1` proves patch support.

Persist bounded preview records with explicit expiry if review must survive
navigation. Bind the opaque identifier/fingerprint to actor/connection, note,
base, operations, evidence dependencies, authorization scope and preview result.
Apply cannot substitute payloads, accept expired reviews or expose a proposal to
another account. Return structured hunks and a readable plain/unified diff so
MCP hosts without a custom UI can show the same changes. Label truncation and
provide authorized bounded continuation, never an apparently complete partial diff.

Normal manual typing is already an explicit edit: do not require a confirmation
dialog per autosave. It uses the same validator and commits guarded transaction
patches directly; its resulting change record feeds History. AI/agent proposals
use preview/review/Apply. MCP hosts control presentation: supply reviewable data
and explicit instructions, but do not claim a server can prove a person viewed
the diff merely because an agent supplied a review identifier or consent flag.

### Compatibility without semantic surprises

Do not redefine existing `update_memory.content` as a fragment: old clients would
corrupt notes. Keep legacy complete-body writes version-fenced and labelled as
replacements, route them through the same document gateway and preserve their
documented metadata semantics. New first-party clients and generated skills must
use targeted operations for passage edits. On an older server, report unsupported
patch capability; never silently fall back to replacing the whole body.

Existing `get_memory`/search/export consumers keep a Markdown representation.
Structured reads are opt-in to avoid inflating every list/recall response. New
snapshot/patch paths must not pass through legacy `.trim()` normalization, which
would modify text outside a requested range. Legacy normalization remains explicit
until a separately approved compatibility change.

## Review and browser behavior

Build one pure structural/text diff result consumed by web and MCP. Compare saved
revisions or the exact base/result of a proposal. Identify inserted/deleted/moved
blocks, then changed words within edited prose; use source/line diff for code,
tables, syntax-only changes and unsupported constructs. Compare attributes and
task states too. A move must not appear as an unrelated deletion/insertion when
node lineage is known. Historical raw-text fallback must be labelled.

Replace the shared `RevisionCompare` internals and adapt all callers: History,
restore review, unsaved/conflicting drafts, Ask edits, cleanup/merge assistance.
Show changes by default, expandable unchanged context, and a complete-source view
for verification. Wide screens may offer side-by-side; narrow screens default to
unified. Use textual Added/Removed labels, not color alone; support keyboard,
screen readers, forced colors, wrapping and horizontal code scrolling.

Keep the mounted CodeMirror view. Translate transaction changes to guarded block
operations, respecting composition, local undo groups, source/preview switches,
formatting, checklist toggles, media insertion and section navigation. Preserve
the existing debounce and explicit Save. Batch edits without creating an audit
entry per keystroke; ensure held responses cannot overwrite newer typing.

Retain a base snapshot, pending immutable batch and subsequent local transactions
in the existing private session draft lifetime. An uncertain save must reconcile
its original operation before issuing another. Report conflict/retry/failed/saved
states truthfully in reserved feedback space, without remounting the editor,
moving focus/scroll or rebuilding unrelated rows. Do not add on-disk drafts or an
offline collaboration promise as an accidental consequence.

Initially require exact whole-note base revisions. Later, opt-in rebase may accept
disjoint blocks only if target hashes, structure, anchors and permission/lifecycle
checks still hold. Edits to the same block, changed neighboring insertion anchors,
delete-versus-edit, split/merge and uncertain lineage conflict conservatively.
Preview/AI evidence dependencies remain stricter: any changed evidence/result
requiring new review must regenerate the diff, not be silently rebased.

Undo submits inverse operations with guards against current affected nodes, not
an old whole-document snapshot. It leaves unrelated later edits intact or refuses
with a clear conflict. Restore remains an explicit new revision and full-document
change review; it does not mutate history or reactivate deleted/private evidence.

## Durable work, migration and recovery

Bounded document validation/commit stays synchronous. Its transaction also stores
the revision/change record and existing durable indexing/enrichment outbox work.
No model/provider calls inside SQL transactions. Reuse the existing RabbitMQ/worker
stack; queue opaque IDs, never private patch payloads or credentials.

Use additive schema first. A bounded lazy conversion may occur on a single write;
bulk current-note conversion runs as checkpointed durable worker jobs, not a
request loop, detached promise or browser job. Backfill must be replayable with
bounded leases/retries, version/hash compare-and-swap and fresh lifecycle checks.
If a note changes or is deleted while parsing, discard the stale result and never
restore it. Representation-only conversion does not create an authored revision,
change expiry or queue redundant model work. Keep old history unchanged.

Mixed-version deployments are a major risk: an old API/worker can bypass the new
gateway and update only `content`. Do not enable structured writes until every
writer is upgraded or fenced; choose/test an explicit representation-generation
guard. Inventory create/update, legacy correction, restore, imports, task toggles,
profile/handoff writes, Ask/assistance Apply/Undo and worker paths, not just MCP.

Before live schema work, require owner-approved backup, isolated populated restore,
forward migration and compatibility preflight under the existing rollout policy.
Keep raw Markdown readable during partial conversion; progress is persisted and
usable notes do not wait on library backfill. Flags gate new tools/editor paths,
not tenant isolation. After structured writes begin, rollback means a compatible
forward repair/read-only mode, not deploying a writer that drops structure. Stop
writes if projection consistency cannot be guaranteed. Do not drop legacy columns
or retained history in this workstream.

Markdown/PDF/copy/public rendering use the compatibility projection. Version the
account/notebook export manifest to include document schema, node IDs and authored
change history where authorized. Test import/restore ID remapping when copying
into a new note; recovery of the same identity preserves IDs. Preserve original
media authorization and source references. Search/enrichment jobs remain fenced
to committed content versions; partial backfill is not search readiness.

## Delivery phases and exit gates

Execute in dependency order. Each phase is a focused PR (split further if needed),
not one schema/editor/agent rewrite. No phase is marked delivered by a design alone.

| Phase                         | Deliverable and likely files                                                                                    | Exit gate                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P0: contract prototype        | Shared lossless block parser/serializer, ID lineage, patch union, deterministic diff and fixture corpus         | Exact roundtrip/untouched-range properties; supported syntax/limits/storage ADR settled; no new editor or collaboration dependency assumed    |
| P1: storage and gateway       | Additive migration/models; document service; route every content writer through it; durable conversion/backfill | Populated upgrade and mixed-writer fencing pass; document/projection/revision/outbox atomicity and real-role RLS proven                       |
| P2: API and agents            | Read/preview/apply/compare service/catalog; HTTP/remote MCP/stdio; skills/plugins and capability negotiation    | Identical contract outcomes on every transport; retries/conflicts/review binding; packed and native hosts verified                            |
| P3: browser patches           | API/cache/drafts adapter and CodeMirror transaction integration; manual guarded autosave                        | Paragraph edits never send full-note replacement; held saves/newer typing/IME/navigation recovery preserve content, focus and Undo            |
| P4: unified diff review       | Shared diff presentation across history, restore, conflicts, Ask and assistance; inverse-operation Undo         | Actual hunks and syntax-only changes visible; every proposal writes only declared targets; accessible desktop/phone review and no stale Apply |
| P5: concurrent safety         | Opt-in disjoint-block rebase, trustworthy actor/connection audit and explicit conflicts                         | Interleaved tab/agent operations preserve both unrelated edits; same-block/structural conflicts never overwrite; no multi-user product claim  |
| P6: qualification and rollout | Backfill/recovery controls, telemetry allowlist, versioned exports and owning docs                              | Owner-run migration prerequisites, staged activation, exact-source gates, real journey acceptance and rollback/read-only drill pass           |

P0 precedes persistence commitments. P1 precedes enabling patch tools. P2's
preview/diff contract precedes P3/P4 consumers. Ship initial exact-version behavior
before P5; do not advertise simultaneous collaboration before its own permission,
transport and convergence work. No calendar estimate is reliable before the
lossless parser and writer-inventory gates.

## Acceptance matrix

- **Preservation:** edit a sentence in a multi-section note; hash all untouched
  source slices before/after. Cover CRLF, blank lines, repeated paragraphs/headings,
  nested lists/quotes, table pipes, code fences, references, opaque syntax and media.
- **Structure:** stable IDs across moves; deterministic split/merge; invalid IDs,
  cycles, excessive nesting/size/operations and ambiguous anchors rejected atomically.
- **Concurrency:** two patches from one base on separate blocks; same-block edits;
  move/delete/split races; metadata/notebook moves; expired reviews; lost responses;
  replay with the same ID and changed payload; undo after an unrelated later edit.
- **Privacy:** cross-tenant and same-tenant unauthorized-notebook reads/writes;
  node-ID substitution; forged actor/source; revoked grant/session; expired/archived/
  deleted notes and notebooks during preview/apply/backfill; no private diff telemetry.
- **Review:** insertion/deletion/move/formatting/task-only changes, equal documents,
  long lines and bounded/truncated history. Both structured and legacy revision
  comparisons must reflect the actual committed bytes; no generated explanations
  may substitute for a deterministic diff.
- **Recovery:** crash before/after commit, broker outage, duplicate delivery, stale
  worker lease, changed/deleted note during conversion, populated migration,
  projection mismatch, export/import/restore and compatibility-read fallback.
- **Browser:** actual API integration plus component fixtures; desktop/tablet/390/320px,
  keyboard/screen reader, forced colors, slow/offline/failed/uncertain saves, IME,
  mounted-editor/focus/scroll stability, task/media edits and back navigation.
- **Integration:** remote MCP, HTTP and packed stdio/native plugins return equivalent
  edits/diffs; old client/new server and new client/old server are explicit and safe.
- **Performance:** measure patch/diff size, p95 commit/review latency, history-page
  cost, bundle impact and backfill contention using the current maximum note and
  representative revision/library counts. Agree budgets in P0; record measured
  evidence, not untested claims of faster or incremental indexing.

Follow [verification](../development/testing.md): root lint/types/build/artifacts,
docs and relevant backend tests against disposable real PostgreSQL/RLS plus
broker/worker cases. Website phases add website lint/types/build, bundle checks,
Chromium and focused WebKit/device qualification. Generated-agent changes add
guidance, packed artifact and native-host tests. Backend changes start with failing
tests. Do not reset existing databases or weaken conflict/security assertions.

## Documentation and completion

Update the owning guides when their behavior actually ships: workspace,
agent-note-writing, server, Ask/selected-source/assistance, imports, sharing,
jobs/exports and schema recovery. Replace stale complete-body guidance only for
patch-capable paths; retain a clearly labelled legacy contract. Keep proposed
behavior separate from current behavior and record historical evidence separately.

Implementation PRs target protected development, are assigned to `miniaxolotl`,
minimally labelled and include focused changes/checks. Relevant reviewed synthetic
screenshots belong in `documentation/design/screenshots/structured-documents/`;
embed only a small preview in the PR, at most four images per row, linking the full
gallery. This planning-only change needs no screenshot. Do not use Copilot.

Use task-owned worktrees under `~/Development/bramble-labs/worktrees/` and local
`plan.md`, `notes.md`, `status.md` under `~/Development/bramble-labs/plans/grove/`.
Remove only clean stale task worktrees after confirmed merge and safe detachment.
Shared library/CLI changes release all bundled consumers through the coordinated
protected flow; a plan/feature PR does not itself authorize production migration,
publication, deployment, provider changes or future sharing.

### Decisions to close in P0

1. Lossless block granularity and nested/opaque fallback behavior, proven by corpus.
2. Exact operation/diff bounds and any new snapshot/export fields, with measurements.
3. Review expiry/persistence and the human-review affordance available in each host.
4. Compatibility window for legacy replacement clients; no silent breaking change.
5. Whether P5's conservative block rebase is enabled initially or stays opt-in.
6. A separate collaboration design later: membership/roles, revocation, ordering,
   offline convergence, shared Undo, presence and document-history visibility.
   Evaluate OT/CRDT approaches there; stable block IDs alone do not solve them.
