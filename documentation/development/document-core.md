# Structured document core

`@lib/shared/documents` is a pure, versioned document/patch/diff foundation. It is
not connected to note persistence, HTTP, MCP, plugins or the web editor yet.
Current notes still use the [complete-body editing contract](../agent-note-writing.md#editing-without-losing-information).
The [implementation design](../design/structured-documents.md) owns the remaining
storage, integration, review and collaboration work.

## Representation and preservation

`createDocument({ noteId, revision, source })` constructs a schema-version-1
snapshot. It uses the existing CommonMark/GFM parser versions, retaining exact
source slices rather than regenerating Markdown from a rendered tree. A block
contains `id`, `kind`, `source` and SHA-256 `hash`; the envelope has the note ID,
revision, ordered blocks and a hash covering document identity/order/source.
The snapshot hash excludes revision, allowing an unchanged body to be identified
separately from version changes. Hashes detect mismatches, not authorization.

- Top-level headings, paragraphs, lists, quotes, code, tables, definitions and
  thematic breaks are classified. Compound blocks are atomic structural units;
  passage edits may address their exact source ranges. No nested node model yet.
- A block owns its trailing separators; leading gaps get their own opaque block.
  Unsupported source stays opaque. If parsing exceeds the block limit, the entire
  source becomes one opaque block rather than being truncated or normalized.
- Preserve CRLF, whitespace, code, task syntax, Unicode, links and media references.
  The core does not render HTML, resolve attachments or fetch external resources.
- Initial construction allocates fresh UUIDs. Retain that snapshot and mutate it
  through patches to preserve identities; constructing it again from Markdown is
  not ID reconciliation or historical lineage recovery.

`serializeDocument(snapshot)` concatenates source verbatim. It is a typed projection,
not an untrusted-input validator. `validateDocument(unknown)` checks strict schema,
unique IDs, semantic partitioning and every source/snapshot hash; use it at external
boundaries. Patch and document comparison entry points do this automatically.
No constructor/validator trims text. The core permits nonempty whitespace for
lossless representation; future persistence must still enforce the note's content
and lifecycle rules. Web Crypto supplies SHA-256 and UUID generation; browser
consumers need its supported secure context. No Node-only imports are bundled.

## Guarded patch batches

`applyDocumentPatch(snapshot, patch, scope)` returns a new `{ document, diff }`
without mutating inputs. The strict patch contains `noteId`, `baseRevision`,
`baseHash`, `operationId` and an ordered `operations` array:

| Type           | Preconditions and effect                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `replace_text` | Node ID/hash, UTF-16 `from`/`to`, exact `oldText` and replacement `text`; supports bounded insertion/deletion within source |
| `insert_block` | Exact adjacent `anchor: { afterId, beforeId }` and source; null marks an edge                                               |
| `delete_block` | Exact node ID and hash                                                                                                      |
| `move_block`   | Exact node ID/hash and guarded destination anchor, resolved after removing the moved node                                   |

Operations address the sequential intermediate state. Later operations on changed
blocks must use the updated hash/range. The whole batch produces one next revision;
any failure rejects without returning or modifying a partially applied snapshot.
Reparse after each operation to verify boundaries: if an edit merges/splits another
block, reject `structure_conflict` rather than changing unrelated identities. Split,
merge and whole-document replacement are deliberately not implicit fallbacks.
New inserted IDs are deterministic UUIDv8 values derived from note ID, operation ID
and ordinal; replaying the same pure input returns the same result.

The independently supplied trusted `scope` contains whole-block `nodeIds`, allowed
insertion anchors and optional `ranges: [{ nodeId, from, to }]`. A range permits
text edits only, not deleting/moving its containing block. Sequential authorized
edits move later range offsets without exposing the unchanged gaps. UTF-16 bounds
cannot split a surrogate pair; unpaired surrogates are rejected. Combining marks
are not normalized, and this core does not implement grapheme-aware editor UX.

**Scope must come from the authorized selection/request, not the model's patch.**
The pure function cannot establish human intent, authenticate a principal, check
current grants/lifecycle/media, issue a review ticket or persist idempotency.
Those are mandatory future service responsibilities. In particular, enforce
operation-ID uniqueness/payload fingerprinting across revisions so an ID cannot
be reused to allocate a previously deleted identity. Do not use this library alone
as an HTTP mutation handler or permit callers to self-grant edit scope.

Errors expose bounded codes, not source text: `invalid_document`, `invalid_patch`,
`document_mismatch`, `version_conflict`, `target_conflict`, `out_of_scope`,
`structure_conflict` and `no_change`. Unknown fields/operations, empty batches,
no-op results, exhausted revisions and exceeded limits are rejected.

## Deterministic diffs

`compareDocuments(before, after)` validates both same-note snapshots and reports
insert/delete/move/edit events with exact source before/after. An insertion that
shifts indices does not label all existing blocks as moved. Events include their
before/after positions, and the diff includes both snapshot hashes and revisions.
A stable-ID LCS gives
a deterministic minimal move interpretation; tied reorderings are not an audit of
which action actually caused the order. Persisted operations will supply that
provenance later. A moved-and-edited node can have both event types.

`diffDocumentText(before, after)` returns source-preserving equal/insert/delete
parts. In `words` mode, whitespace and non-whitespace tokens are compared exactly,
including Markdown syntax. If the LCS budget would be exceeded, `bounded` mode
uses a linear code-point prefix/suffix diff. It is coarser, not truncated; filtering
insert parts reconstructs before, and filtering delete parts reconstructs after.
Diff text is untrusted source: future UI must escape/sanitize it, not inject HTML.

Legacy raw-text comparisons can use the text helper without pretending old notes
have stable block lineage. This increment supplies structured data, not a visible
diff UI, unified-diff renderer, review/apply workflow or safe Undo implementation.

## Explicit initial bounds

The executable constants are in `lib/shared/src/documents/schema.ts`:

| Resource                                       | Bound                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Source/result and each text-diff side          | 1–6,000 UTF-16 units for snapshots; diff sides may be empty             |
| Blocks                                         | 256; dense input falls back to one opaque block                         |
| Operations per batch                           | 50                                                                      |
| Cumulative inserted/replacement text per batch | 6,000 UTF-16 units                                                      |
| Passage scopes                                 | 256 ranges; whole-block scopes 256 IDs                                  |
| Insertion scopes                               | 257 adjacent anchors                                                    |
| Word-diff LCS                                  | 262,144 cells, then linear fallback                                     |
| Revisions                                      | Positive safe integers; cannot advance beyond `Number.MAX_SAFE_INTEGER` |

These are resource ceilings, not measured latency/SLA claims or an increased note
quota. Structural comparison uses at most a 257×257 LCS table. Strict bounded
schemas and source limits run before Markdown parsing; no remote I/O or background
execution occurs in this core. Bulk conversion remains future durable worker work.

## Verification and remaining integration

Run `pnpm exec tsx --test tests/src/documents.test.ts` and the usual
[verification gates](testing.md). The synthetic corpus covers GFM, dense/opaque
fallback, exact source preservation, tampered snapshots, sequential atomic batches,
target scopes, conflicts, Unicode, stable IDs/moves, diff reconstruction and
browser-platform bundling. It uses no database or provider. Browser bundling is not
real editor, device or multi-user acceptance.

Before enabling this in a product path, complete persisted gateway/idempotency and
authorization, mixed-writer fencing, immutable revision/export compatibility,
review binding, legacy replacement ID reconciliation, guarded inverse operations,
performance qualification and browser/MCP adapters. Concurrent rebase, CRDT/OT,
sharing roles and public editing remain outside this increment. No schema migration
or deployment is required or authorized by the core alone.
