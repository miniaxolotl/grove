# Import notes and documents

Browse uploaded originals, their saved-note/notebook/chat locations and account
storage in **[Files & storage](files-storage.md)**, linked from Settings, imports
and Ask Grove. Viewing files never saves or shares them.

Choose **Import notes** from Notes, **Notebook options**, or **Settings → Data**.
Upload UTF-8 Markdown (`.md`, `.markdown`), plain text (`.txt`), DOCX or text-based PDF
files. Choose an existing notebook, create a named notebook (optionally nested),
or leave notes Unfiled. **Use for all notes** sets a batch destination; individual
previews can override it. Notebook entry points preselect that notebook in the
placement control; apply it explicitly before confirmation.

## Review before saving

1. Upload files; preparation starts automatically. Preparation creates no library
   notes, notebooks or public links.
2. Review proposed notes. Long documents split at paragraph boundaries when
   possible, with deterministic fallback splits within the 6,000-character note
   limit. No summary replaces the extracted text. Original bytes preserve material
   such as UTF-8 BOM and original line endings; extracted text normalizes line endings.
3. Exclude unwanted notes, edit their content and choose destinations. Save or
   discard local edits before continuing or closing the dialog. Unsaved local edits
   are not persisted across a browser crash; successfully saved previews are.
4. Optionally choose **Suggest organization**. This uses the existing generation
   provider, notebook-filing preference and generation allowance. Suggestions may
   propose topic groups/new names or choose a clear existing match using sampled
   notebook evidence. They change only review drafts, not the library. Manual import
   works without AI. Suggestions do not run external research or rewrite content.
5. Review the sharing notice, check the confirmation and choose **Confirm import**.
   New notebooks are created only with their first imported note. Existing notes
   are never silently merged or overwritten. New names are explicitly new notebooks,
   even when another notebook has the same display name.

Imported text immediately follows the destination notebook's existing public-share
scope. Original files stay private and are **not** served by public note/notebook
links. Uploading notes does not transfer internal Grove image references or local
attachments; remove/replace unsupported references in the preview if necessary.

## Limits and extraction

| Limit                                  | Current value                       |
| -------------------------------------- | ----------------------------------- |
| Files per batch                        | 25                                  |
| Uploaded file                          | 3 MiB, through both website and API |
| PDF pages                              | 100                                 |
| Extracted text per file                | 1 MiB UTF-8                         |
| Proposed notes per batch               | 500                                 |
| Outstanding reviewed batch per account | 1                                   |
| Review draft lifetime                  | 24 hours                            |

PDF extraction does not reproduce exact layout. Reading order and tables may need
correction. Empty pages are called out; a mixed scanned/text PDF can produce only
partial text. Entirely scanned or password-protected PDFs are refused. DOCX extracts
paragraph text, not exact Word layout, images or embedded objects. Macro-enabled or
encrypted packages, malformed XML and excessive ZIP expansion are refused. OCR,
legacy `.doc`, RTF/ODT, arbitrary ZIP/provider exports, recursive folders and image extraction are
not supported in this release. One unreadable file does not discard usable files.

PDF.js runs outside the API request process with a 15-second deadline, a 128 MiB
V8 old-space cap and bounded output. Node permissions allow reading the parser's
own package, not application files, writes, subprocesses or native addons. Input
is bytes, never a user-supplied URL. No PDF actions/scripts/rendering or remote
asset loading are requested. The V8 heap bound is **not a total RSS guarantee**;
keep worker/container memory limits and bulk concurrency appropriate to deployment.

DOCX uses pinned `fflate`/`saxes` in the same isolated process, limited to 256 ZIP
entries, 8 MiB per expanded entry, 16 MiB total expansion and XML depth 128. DTDs
and custom entities are rejected; external relationships are never fetched.

## Ask about documents first

In **Ask Grove**, attach up to five new files per selection (25 available files per
chat). Reading starts automatically. Wait for Ready, retry a failed reading job,
or explicitly remove an unreadable file; Send never silently omits selected files.
Uploads create no library notes/notebooks and are not available to agent recall.

**Send** retains exact private originals with the chat and sends bounded passages
to the configured generation provider. Answers use separate document citations:
filename plus PDF page or text/DOCX part. Open a citation to inspect its extracted
passage or download the private original. Follow-ups reuse this chat's accepted
sources; another chat does not inherit them. Document turns suppress external
research server-side, even if Web search/Research are enabled.

Retrieval is lexical and bounded to 12 passages/24,000 characters per question.
Selected passages are not proof of reading every page. Partial coverage is labelled;
ask a narrower question when more detail is needed. Quotations and chunk revisions
must match the actual supplied evidence; unsupported model prose is not published
as a document fact. Scans still require OCR elsewhere.

Two save paths stay distinct:

- **Save document text…** opens the normal reviewed deterministic import, using all
  extracted chunks and the same originals, without browser re-upload or another
  original-storage write. Review destinations, edits and sharing, then confirm.
- Ask “Create study notes/a notebook from these documents” for an AI-generated
  preview, not a complete transcription. Existing Manage notes, Apply and Undo
  protections remain. Supporting document bindings commit with new notes. The
  note's **Private document sources** disclosure can download originals even after
  removal of the chat; public links never grant original access.

Ready, readable, unconfirmed direct imports also offer **Ask about these documents**.
This copies the staged original bytes server-side into an independent chat and
re-extracts them; reviewed edits are not mistaken for source text. The import review
stays available. Both copies share the account's 75 MiB unconfirmed staging ceiling;
at capacity, finish/remove other pending uploads first. Completed imports and
already chat-backed reviews do not use this handoff.

Unaccepted uploads expire after 24 hours; removal clears staged bytes and excerpts.
Accepted originals follow retained-source policy: Remove revokes chat use/access,
not physical original deletion. Deleting the chat masks its evidence and unapplied
previews. Saved notes and their separate private source links remain independent.
Account deletion disables all access. Restore replays current document removals,
clears unsent staging and invalidates old leases; it cannot resurrect revoked chat
sources or silently approve a save.

## Progress, retries and originals

Preparation and import use leased, checkpointed background work. You may close the
dialog and resume from its recent-import list. File/confirmation request identities
survive uncertain retries in the mounted dialog; a page reload finds accepted
files/batches on the server. Source uploads not yet accepted must be selected again.

Cancel before confirmation saves nothing to the library and clears unconfirmed
bytes/previews. During import, cancellation stops remaining work; already-created
notes/notebooks remain. **Retry remaining work** resumes a failed task without
duplicating committed records. It does not overwrite later edits or revive deleted
notes. Re-importing the same file in a new batch can intentionally create duplicates;
review the warning and exclude unwanted notes. There is no destructive batch Undo.

Confirmed source files retain their exact SHA-256-verified bytes in the existing
private source store, using separate document validation rather than image/WAV
upload endpoints. Original downloads are owner-session-only attachments, available
from import results while at least one imported note remains visible. Source
filename, page spans and normalized extraction offsets are retained with the
source-to-note mapping; reviewed note text can differ from those original spans.

Each source write attempt reserves bytes and one slot under the existing **1 GiB /
1,000 attempt** account media safety budget. Failed/uncertain attempts remain
tracked/charged; deleting notes or cancelling does not delete source objects or
refund uncertain storage. Expiry cleanup can remove only unconfirmed database
staging/previews, never retained original objects. Account deletion ends access and
clears unconfirmed drafts; authored notes/history and accepted originals remain
retained under Grove's existing deletion contract.

## API

All routes require the owning website session, not API keys, OAuth agents or public
links. Use stable UUIDs; changing the input of a replayed upload/confirmation is a
conflict. Responses use the ordinary private/no-store envelope.

| Method and route under `/v1`                     | Input/result                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `POST /import-batches`                           | `{id}`; create one batch                                                                                     |
| `GET /import-batches`                            | Latest 20 accessible batches                                                                                 |
| `GET /import-batches/:id?after=UUID`             | Status, files, 20 draft notes, next cursor, total/imported counts                                            |
| `PUT /import-batches/:id/files/:fileId`          | Raw bytes; accurate `Content-Length`, percent-encoded `X-Grove-Filename`, lowercase `X-Grove-Content-Sha256` |
| `POST /import-batches/:id/prepare`               | `{id}` task UUID; enqueue extraction                                                                         |
| `PATCH /import-batches/:id/notes/:noteId`        | `{expectedVersion,content?,included?,destination?}`                                                          |
| `PATCH /import-batches/:id/placement`            | `{expectedVersion,destination}`; change all draft destinations                                               |
| `POST /import-batches/:id/suggest`               | `{id,expectedVersion}`; optional grounded grouping                                                           |
| `POST /import-batches/:id/confirm`               | `{id,expectedVersion}`; freeze and enqueue approved drafts                                                   |
| `POST /import-batches/:id/cancel`                | Stop work; keep already-imported records                                                                     |
| `POST /import-batches/:id/conversation`          | `{id,expectedVersion}`; open/replay independent chat for ready unconfirmed originals                         |
| `GET /import-batches/:id/files/:fileId/original` | Authorized private attachment; never an object key                                                           |

`destination` is `null` (Unfiled), `{projectId,version}` (existing notebook), or
`{name,parentId:null|UUID}` (new notebook). Draft versions and destination revisions
are checked before confirmation and at Apply checkpoints. Changed/unavailable
destinations require a new review; they never fall back silently to another scope.

`GET /tasks/:id` and the existing task retry/cancel routes expose background status.
Broker/task payloads contain batch IDs, not files or note bodies. Uploads stream
under the interactive actual-byte limit; ordinary JSON keeps its 128 KiB cap.
`POST /imports` remains the compatible record-based import/connector endpoint and
is not a file-upload or binary restore interface.

### Chat document API

All routes are owning-session-only and private/no-store, under `/v1`:

| Method/route                                                    | Contract                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /conversations/:id/documents`                              | `{version,documents}` with reading/readiness and retry status                   |
| `PUT /conversations/:id/documents/:documentId`                  | Raw bytes with the same filename/length/SHA-256 headers as imports; stable UUID |
| `POST /conversations/:id/documents/accept`                      | `{expectedVersion}`; retain ready originals before Send/save                    |
| `DELETE /conversations/:id/documents/:documentId`               | Revoke chat access; retain accepted originals                                   |
| `GET /conversations/:id/documents/:documentId/passages?after=0` | Up to ten ordered passages, ordinal cursor                                      |
| `GET /conversations/:id/documents/:documentId/original`         | Authorized private download                                                     |
| `POST /conversations/:id/documents/import`                      | `{id,expectedVersion}`; idempotent full-text review handle                      |
| `GET /memories/:id/document-sources`                            | Private source bindings for generated note revisions                            |
| `GET /memories/:id/document-sources/:documentId/original`       | Independent note-authorized original download                                   |

`POST /conversations/:id/turns` accepts additive `documentsVersion`, required when
documents are attached. Keep the same version and full request on uncertain retry;
source changes require a new message, not rebinding an old turn ID. Replies expose
`documentStatements` with exact `{id,version,quote}` chunk references,
`documentSources`, `documentCoverage` and a source-revision snapshot. No storage
keys/staging enter public envelopes or prompts. Reading uses the `conversation_document`
bulk task; retry is available only for still-pending eligible files, never removed
or expired uploads. Format errors require choosing a corrected file.

## Export and recovery

Account/notebook exports include `document_binding` provenance for their exported
notes. With **Include original media**, v3 NDJSON additionally contains paged
`document_source` metadata and offset-addressed `document_chunk` base64 pieces
(at most 48 KiB decoded each). Reassembly must verify bytes/SHA-256. Export format
transport is not note content; the legacy import endpoint does not restore binaries.
Unconfirmed files/drafts and storage keys are not exported.

Account exports additionally carry accepted accessible `chat_document` metadata and
`chat_document_binding` provenance. Include original media adds
`chat_document_source` metadata and offset-addressed `chat_document_chunk` binary
pieces. Notebook exports include only sources linked to their notes, never unrelated
private chats. These binary chunk records are not extracted text passages.

Back up the original source bucket with PostgreSQL, as for images/recordings.
Recovery invalidates unconfirmed review/Apply batches and old task leases rather
than recreating notes from them. Confirmed originals and committed provenance are
retained; current account/note tombstones and revoked grants still govern access.

See [verification](development/testing.md#note-and-pdf-imports),
[reviewed captures](design/screenshots/note-imports/README.md) and
[owner rollout](deploy.md#note-and-pdf-import-rollout-031).
