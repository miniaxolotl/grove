# Structured notes and revision diffs

Notes keep Markdown compatibility while retaining a structured document snapshot
for each newly authored revision. This describes source behavior; deployment needs
the migration and coordinated rollout below. Shared-person editing, invitations,
presence, offline synchronization and automatic concurrent merging are not included.

## Editing and reviewing

Existing browser notes save exact source splices, not a replacement document.
Each splice has UTF-16 `from`/`to`, exact `oldText` and replacement `text`. A save
checks the observed note version, applies the ordered splices atomically, and
preserves every byte outside the declared ranges. Paragraph splits, new sections,
formatting and task changes use the same save path. Creating a note still sends
its complete initial body. Omitted metadata remains unchanged.

History comparisons, conflicting drafts, Ask proposals and assistance review show
added/removed source text with underline/strikethrough as well as color. **Full
versions** expands the complete rendered before/after documents. Code, whitespace
and formatting changes are not silently normalized. Long comparisons use a labelled
grouped diff instead of truncated results. Unsaved drafts above the note limit
retain full-version comparison rather than crashing the review.
Revision history opens the latest previous logical revision's diff first; the complete
current revision follows it. Individual comparisons can still be opened or closed.

The editor stays mounted through saves. Existing local Undo, held saves, newer
typing, session-memory draft ownership and uncertain-operation retry rules remain.
No edits are silently rebased over another writer. On conflict, retain the draft,
review the current note and deliberately resolve it. Restore creates a new revision;
history is never rewritten. Existing version-fenced assistance Undo refuses stale
state instead of overwriting later edits. There is no new on-disk draft storage.

## API and connected agents

`GET /v1/me` advertises `documentEditing` capabilities. Older servers that lack
these tools do not gain partial editing by interpreting `content` differently.
Legacy `remember` and `update_memory.content` still mean complete-body replacement.
Do not silently use them as a fallback for an unavailable passage-edit tool.

The shared HTTP/MCP/stdio/native-plugin tool catalog exposes:

| Tool                       | Contract                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_memory_document`      | Note ID and optional revision; returns schema version, revision, ordered stable-ID source blocks and hashes                                                |
| `preview_memory_patch`     | ID, expectedVersion, operationId, capture and exact sequential edits; returns source/structural diff and an expiring review token without changing content |
| `apply_memory_patch`       | The identical preview arguments plus its review token; commits one revision and preserves ordinary retry identity                                          |
| `compare_memory_revisions` | ID and beforeVersion/afterVersion; returns authorized deterministic block/source differences                                                               |

Use `POST /v1/tools/<tool>` for the HTTP equivalents. Read source and version first;
calculate offsets against the concatenated source, not against rendered text or a
single block. Show the preview diff, then apply only on user direction. Never guess
node IDs or ranges, silently select the first repeated text match, or widen an edit.
The host controls how a diff is presented; a token is not proof of human review.

Review tokens bind the exact arguments, principal/connection/session and expiry
using the existing server secret. They contain no note text. New applications expire
after 30 minutes. Identical retries of an accepted operation can reconcile after
that expiry, but still require current authorization and an identical fingerprint.
Changed payloads need a new operation and preview. Revoked access, paused automatic
capture, changed source/version, inactive notes and expired sources fail closed.

For ordinary partial metadata writes, `update_memory` remains available. Its
optional `edits` use the same bounded splice validator, mutually exclusive with
legacy `content`. The browser's `POST /v1/memories` accepts those partial edits
(as does `POST /v1/memories/:id/edit`) through that service
directly because typing is already an explicit edit, not an AI proposal. Route/body
IDs must agree. Read-only tools require read capability; preview/apply require both
read and write. Existing notebook grants, media rules and capture controls remain.

## Storage and compatibility

Migration `20261105_036_structured_documents` adds nullable `document`, `change`,
`actor` and `revision_group` JSONB fields to the existing RLS-protected
`memory_revisions` table, with a history-group index and group-number bounds.
It does not rewrite retained notes/history or expand permissions. A SQL constraint
requires non-null document identity/revision and exact concatenated source to match
the revision. The core additionally validates unique IDs, hashes and partitioning.

The common revision writer persists Markdown, document, diff and trusted actor
information in the same transaction as version changes, invalidation and durable
indexing/enrichment work. Account/connection identity is taken from the authorized
principal, not client-supplied source provenance; internal work without a principal
is labelled service work. Set-based notebook lifecycle revisions preserve document
IDs while changing their revision number. Existing media/public readers use the
Markdown projection and their unchanged authorization, never raw diff HTML.

Legacy revisions without a document have deterministic, bounded lazy reads. Their
IDs do not change between reads of the same revision. Later writes preserve exact
unchanged blocks; unique moved blocks retain identity, and clear single-block
edits/splits retain one prior identity. Ambiguous repeated/restructured blocks get
new IDs instead of guessed lineage. No bulk backfill or background rewrite runs
inside a request. Notes are immediately usable without a conversion wizard.

An old writer may produce a revision without structure; reads derive only that
revision's actual source, never a stale current snapshot. Current note/revision
projection mismatches stop structured editing. Legacy history remains immutable.
Account/notebook revision exports include document/change/actor fields alongside
source; plain Markdown exports are unchanged. These private fields inherit the
same tenant/lifecycle/retained-deletion visibility as authored history and must not
be sent to analytics. Importing Markdown is a new note identity, not a claim to
restore historical node IDs. Database backup/restore preserves those identities.

## Reducing writes and inference

An identical partial save records its retry receipt but does not rewrite the note,
add a revision, invalidate derived results or enqueue inference. Rate limiting and
operation accounting still apply; this is not a zero-database-write request.
Legacy replacement/lifetime semantics remain unchanged.

Passage edits commit immediately. Pending embedding/classification/organization
jobs wait at least five seconds after the latest passage save, retaining the latest
durable source version. Earlier unclaimed versions are replaced; a worker already
running cannot be recalled, but existing lease/version checks reject stale results.
Continuous edits can defer enrichment; the UI must keep showing pending rather
than pretend indexing is finished. Metadata-only updates do not get this delay.

Existing account-scoped exact caches, single-flight leases, provider backoff and
bounded concurrency remain in use. This is coalescing, not a provider batch API.
See the [AI investigation](evaluations/ai-services-2026-11-05.md) for measurements,
batching tradeoffs and the separate live-service qualification limits.

## Limits, rollout and verification

Keep the 6,000-character note limit. Source edits allow at most 50 operations and
6,000 cumulative inserted UTF-16 units; ranges cannot split surrogate pairs. Empty
results, invalid old text, no-op agent previews and conflicting versions are rejected.
The [core contract](development/document-core.md) owns block/diff budgets. Stable IDs
and diffs are not CRDT/OT, fine-grained locking or proof of multi-person convergence.

Before production rollout, follow the [schema procedure](operations/schema.md):
owner-approved backup, isolated populated restore/upgrade, runtime preflight, then
the compatible API/worker and website/plugins through the protected coordinated
release. Do not drop the new fields or deploy a writer that assumes they are absent
after activation. An incompatible rollback requires a forward repair or read-only
mode. No migration is automatically run by the website or MCP request path.

### Coalesced revision history

Small nearby source edits from one writer/editing session extend the same logical
revision, instead of filling history with autosaves. Membership is decided inside
the atomic save transaction using the last committed edit; no worker, timer, extra
AI request or delayed durability is needed. History groups before applying its
100-entry limit, so a long burst does not hide older useful restore points.

The quiet window is **30 seconds**, separate from the five-second inference delay.
A group is capped at two minutes and 1,000 cumulative changed UTF-16 units. Each
eligible edit changes at most 256 units, touches no line break, preserves block
identity/order/kinds, and replaces no more than a quarter of the prior note (with
a 32-unit allowance for short notes). These are conservative deterministic limits,
not an AI judgment of semantic importance.

Another trusted actor/connection/login session or editor session, an idle gap,
metadata/lifecycle/restore changes, structural edits or larger changes start a new
revision. Larger changes close their group too, so later tiny edits cannot be
absorbed into a major rewrite. Explicit **Save note** / Ctrl/Cmd+S creates a closed
checkpoint when there is a change; a no-op still does not manufacture a revision.
The browser changes its session hint at an explicit save, including a clean save.

MCP/API callers can supply one stable UUID `editSession` across a targeted editing
task; `checkpoint: true` makes a separate, closed revision. Preview/apply binds both
fields. Without a hint, a trusted authenticated session can provide continuity;
otherwise saves remain separate. A client hint is never trusted actor identity and
cannot join another writer's group. Missing legacy metadata is not guessed or
retroactively merged, and ambiguous complex edits remain distinct.

History returns `revision` (logical display number), `firstVersion`, `saves`, and
the final immutable `version`/content of the group. **Use `version`, not `revision`,
for exact reads, comparisons, citation/media references and restore.** Every save
still has its own version fence, operation receipt and retained immutable source
snapshot; coalescing does not overwrite snapshots another reader may have cited.
Exports retain those snapshots and their `revisionGroup` metadata. The web history
shows one entry per group and compares its final content; restore starts a new
logical revision. Group growth retains the history row's identity in the UI.
[Desktop and phone captures](design/screenshots/structured-documents/README.md)
show two saves in one entry with the combined diff.

Run `revision-groups.test.ts`, `document-editing.test.ts`, `structured-documents-migration.test.ts`, core,
memory-tool, lifecycle, conversation/assistance and export/recovery tests against
disposable PostgreSQL using actual non-owner roles. Verify remote/shared MCP and
packed artifacts, then browser source-splice payloads, held/uncertain saves,
history/conflict diffs, desktop/390/320px, keyboard/focus, accessibility and recovery.
Provider/device/multi-user qualification is separate from these source checks.
