# Images, recordings and speech — plan review

Reviewed 22 October 2026 against development `22e76b4` (v1.11.0).
**Design only: none of these media features is implemented by this review.**
The recovered three-slice scope remains useful, but is not implementation-ready
until the decisions and gates below are resolved. No provider provisioning,
migration, merge or production rollout is authorized by this document.

## Current evidence

- The recovered media plan records discovery/setup only: no implementation,
  tests, feature commits or media PRs. Its old worktree was not restored.
- Live GitHub readback found no open issues and workspace refinement
  [#82](https://github.com/miniaxolotl/grove/pull/82) open at `eb3b113`, with
  successful CI. This is a dated observation, not an ongoing ownership guarantee.
  Recovered navigation work is separate; coordinate editor/Markdown ownership
  before implementation and recheck both branches before integration.
- [Migration registration](../../lib/database/src/migrations.ts) ends at 015.
  The historical 016/017/018 reservations are **proposals**, not allocated IDs;
  recheck active branches and the project plan before assigning migration names.
- [Artifact storage](../../packages/api/src/artifacts.ts) accepts only
  `exports/...ndjson` keys. [Background exports](../../lib/memory/src/exports.ts)
  page typed records; they do not preserve attachment bytes today.
  Cloud storage defaults to disabled; this source review does not verify current
  deployed credentials, buckets or lifecycle configuration.
- [Markdown](../../packages/website/src/components/dashboard/markdown.tsx)
  intentionally renders images as links. Individual Markdown/PDF exports are
  browser-side; the deferred [PDF renderer](../../packages/website/src/lib/note-pdf-document.ts)
  does not currently embed owned media.
- [API admission](../../packages/api/src/admission.ts), the Node HTTP adapter and
  the [website proxy](../../packages/website/src/app/api/grove/[...path]/route.ts)
  impose 128 KiB body limits. The ordinary path buffers bodies and is not a media
  upload transport.
- [AI providers](../../lib/ai/src/index.ts) implement embedding, decision and
  generation, not STT/TTS. [Account preferences](../../lib/shared/src/preferences.ts)
  already have **14** controls. Speech requires distinct capability/configuration
  contracts rather than assuming text generation can accept audio.

## Review findings and required changes

| Priority | Gap in the recovered plan                                                      | Required resolution                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocker  | Separate buckets are required, but adapter/cleanup enforcement is unspecified. | Enforce durable-media separation from expiring exports and speech cache in configuration, credentials, tracked objects and cleanup. Test misconfiguration rejection.                  |
| Blocker  | An opaque Markdown ID alone neither authorizes access nor preserves history.   | Bind validated media to saved note revisions transactionally; authorize every read using an explicit note/revision context. Never grant account-wide access from possession of an ID. |
| Blocker  | Existing body/proxy limits make ordinary image/audio uploads fail.             | Design a bounded streaming media path through every hop; retain the 128 KiB JSON cap and existing admission for ordinary requests.                                                    |
| High     | Public links expose live text, not historical revisions.                       | Give public media a separate scope-checked path. Never expose private attachment endpoints, old-revision-only media or raw storage URLs through public sharing.                       |
| High     | Portable export and recovery omit the new binary source of truth.              | Define additive archive/manifest and import/backup semantics before PR1; preserve current NDJSON consumers. Test byte identity and missing-object failures.                           |
| High     | STT/TTS have no selected provider, media capabilities or cost contract.        | Specify adapters, formats, limits, opt-in defaults, quotas and privacy before PR3; do not infer these from existing MiniMax/DeepInfra text roles.                                     |
| High     | Upload completion, note save, deletion and worker completion can race.         | Add retry identities, transactional reference publication, quota reservations and lease/source/preference fences. Stage cleanup must serialize with attachment binding.               |
| Medium   | Recovered paths, live-host claims and resource warnings are historical.        | Use current external worktree/plan locations; verify runtime configuration and free space when executing, rather than treating the snapshot as live evidence.                         |

## Recommended implementation contracts

These are proposed acceptance contracts, not existing endpoints or configuration.
Use shared library services for API/worker behavior and keep new controls/renderers
modular so editor history, heading navigation and first-save continuity survive.

### Storage, upload and reference lifecycle

1. Use a private durable media store with a self-hosted persistent local adapter
   and an S3-compatible adapter. Proposed cloud layout is independent private
   DigitalOcean Spaces for authored media and one-day exports. Temporary TTS has
   separate tracked keys/lifecycle; it must never inherit authored retention.
   Provider resources and activation require separate explicit approval.
2. Store tenant-owned immutable object metadata (opaque ID, kind, verified MIME,
   byte length, checksum and storage identity), with same-account foreign keys,
   restrictive RLS and non-owner API/worker permissions. Never deduplicate across
   tenants or disclose another tenant's object existence.
3. Model `staging → validated → attached`; rejection/cancellation/expiry can reclaim
   only unbound staging and operational scratch. Allocate retry-safe upload IDs
   and reserve quota before bytes arrive. Reconcile actual size atomically;
   retries, concurrent uploads and crashes must not double-charge or bypass quota.
4. For a new/unsaved note, permit session-owned staging previews only. Publish
   stable attachment references with the ordinary version-checked note save and
   operation receipt. A lost save response must not orphan or duplicate media.
   Undo/removal from the current text must not delete retained historical bytes.
   A pasted/copied reference in another note requires an authorized binding, not
   automatic access. Keep drafts/retry identities across first-save routing.
5. Introduce a dedicated streaming upload path, with explicit API, Node adapter,
   BFF and hosting/proxy limits. Do not simply raise the ordinary JSON cap. Bound
   received bytes even for chunked or misleading Content-Length bodies, decoded
   pixels/audio duration, concurrent streams, deadlines and storage buffers.
   Cancellation must abort storage work and release permits/quota reservations.
6. Verify actual decoded file content rather than trusting names or MIME headers.
   Pick explicit supported formats and limits before coding. Reject active SVG/HTML
   and unsupported containers; defend against decompression bombs and malformed
   metadata. Decide whether image metadata is stripped and what original bytes are
   retained. Original audio must remain unchanged; playback conversions are derived.

### Read authorization, retention and sharing

- Resolve opaque Markdown references through an authorized note context, never a
  browser-supplied bucket key. Private current/history reads enforce tenant,
  session/connection grant, current notebook scope, note visibility and revision
  permission. Narrow agent grants must not become account-wide media access.
- Public media reads recheck the live share, database-clock expiry, current note
  membership/visibility and the **current saved revision's** media bindings. Do not
  expose history or another note that happens to reference the same object. Moves,
  revocation, archive, note/account deletion and expiry must remove new access.
- Prefer application-mediated private/no-store streams to bearer object URLs.
  Add authenticated audio Range handling (206/416, HEAD, bounded ranges) with the
  same guards on every request and periodic authorization during long transfers.
  Already delivered bytes cannot be recalled; do not claim otherwise.
- Public readers remain usable without JavaScript for images and standard audio,
  and remain isolated from Clerk, inference, workspace caches and replay. No remote
  image fetches, server-side URL import/SSRF or automatic audio playback.
  External image URLs remain explicit links in all renderers and exports.
- Authored media follows [retained deletion](../jobs.md#retained-deletion): deletion
  hides it but does not physically purge retained source/history. Automatic cleanup
  can remove abandoned staging, derived cache and expired exports only. Reusing
  the export cleanup registry for source media is forbidden.
- Account/session teardown, authorization changes and deletion must cancel pending
  browser reads and revoke object URLs; do not persist binary previews in shared
  caches. Logs/telemetry must omit content, filenames, tokens and storage secrets.
  Existing [hosting capability-log limitations](../sharing.md#storage-and-rollout)
  still apply; media paths need their own actual-host verification.

### Exports, backup and restoration

- Keep plain Markdown/copy available, explicitly identifying internal media
  references as non-portable. Offer a separate portable archive containing rewritten
  relative media paths, exact authorized bytes and a versioned checksum/MIME
  manifest. Use safe generated paths; never trust filenames as archive paths.
- Preserve existing NDJSON downloads and add an explicit media-complete archive
  option for account/notebook exports. Keep bounded page/stream assembly,
  cancellation, one-day expiry and source-version fences. Fail honestly if a
  referenced object is missing or changes; never silently deliver an incomplete
  archive as a complete backup.
- Freeze an authorized source snapshot for individual PDF/archive exports,
  including a dirty draft's validated owned media. Preserve unsaved-content labels.
  Embed bounded raster images in PDF without network fetches; audio remains an
  explicit textual reference, not an unsupported promise of embedded playback.
- Back up durable bytes and database references together. Specify missing-object
  detection, checksums, restore ordering and tombstone replay. Restoration must
  not revive deleted access, public links or queued speech. A database-only backup
  is not media-complete. Archive import must validate paths/limits and remap IDs
  into the importing account; retain existing text-only import compatibility.

### Recordings, transcripts and speech

- PR2 records/uploads original audio and provides keyboard/touch playback without
  an AI provider. Use microphone access only after an explicit user gesture, with
  clear recording/stop/cancel state. Stop tracks on cancellation, navigation and
  session teardown. Unsupported recording formats/permissions get upload fallback;
  elapsed-time and byte limits must also be enforced server-side.
- Give each recording independent transcript data/status. PR2 can display an empty
  transcript state without claiming transcription exists. PR3 queues STT against
  the immutable audio identity. Keep machine output separate from user edits;
  using a transcript in note text is an explicit normal save with Undo/conflict
  handling, never a background overwrite of authored Markdown.
- Add explicit STT and TTS provider interfaces, installation configuration,
  secret handling, availability and health tests. Choose supported languages,
  codecs, voices, timeouts, request/duration/text limits and billing reservations.
  Document which audio/text leaves Grove and provider retention. No implicit
  fallback to a different provider/model or use of a text role's credentials.
- Add independent transcription/read-aloud preferences through the shared catalog,
  API, migration, UI, worker and recovery paths. Recommend opt-in for these new
  external-data features; approve defaults explicitly. Provider absence must not
  disable saved recordings, accepted transcripts or ordinary text workflows.
- Reuse durable queues, fair claims, renewable leases, retry budgets and
  account/provider concurrency gates; explicitly assign speech lanes/capacity.
  Fence publication by audio/text revision, account/grant visibility, provider
  profile, preference generation and lease token. Disable/re-enable, retry,
  deletion and worker restart must not publish stale or duplicated output.
- Read aloud is user-started and cancellable, with no inference on note open or
  anonymous shared reads. Cache identity includes tenant, exact text revision,
  provider/model, voice/language and output format. Expiry/source changes prevent
  reuse; an accepted edited transcript is authored data, not expiring TTS cache.

## Decisions to close before implementation

Record the approved values and rationale in the local project notes:

| Gate | Decision still needed                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR1  | Exact Markdown reference grammar and malformed/unknown-reference behavior; revision binding and agent read/write permissions.                                   |
| PR1  | File/decoded-pixel limits, account byte/object quotas, staging timeout, raster formats/metadata handling, HTTP streaming/hosting strategy and admission budget. |
| PR1  | Archive schema, UI labels, import scope and backup/recovery procedure; independent storage configuration and an explicit cloud provisioning decision.           |
| PR2  | Recording formats/duration limits, browser codec fallback, transcript revision/export representation and consent copy.                                          |
| PR3  | STT/TTS providers and data policy, voices/languages, preference defaults, lane/cost limits, cache TTL and playback behavior after AI is disabled.               |

## Three feature PRs and verification

1. **Images** → `development`: migration, isolated media adapters, upload/reference
   services, current/history/public reads, editor/viewer paste/drop, portable
   export/recovery and PDF images. Do not start audio until retention, scope and
   export gates pass with real storage bytes.
2. **Recordings** → the images branch while stacked: original audio, microphone
   lifecycle/upload fallback, Range playback, transcript data/display and audio
   archives. No automatic transcription or speech-provider work in this slice.
3. **Speech** → the recordings branch while stacked: adapters, independent
   preferences, queued STT/TTS, editable transcript use, retry/cancel and cache expiry.

Use cohesive reviewed commits, minimally labelled PRs assigned to `miniaxolotl`.
The recovered instruction to push all three only at the end is historical, not a
requirement of this review; agree implementation publication cadence before starting.
Core-branch PRs trigger CI automatically; stacked feature bases need explicit
exact-head `workflow_dispatch`. Recheck the current workflow filters. Restack after
authorized squash merges and rerun integration checks; no protected-branch pushes.
Release follows the existing coordinated product/promotion contract, separately.

| Area                | Required acceptance evidence                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database/storage    | Fresh and populated forward upgrades; non-owner API/worker RLS; cross-tenant and narrow-grant denial; private local/S3 byte identity; no anonymous objects; storage lifecycle separation.                                                                                    |
| Races/limits        | Spoofed MIME, malformed/oversized/chunked uploads, concurrent quota use, interrupted multipart, crash cleanup versus lost/replayed saves, history/Undo, deleted notes/accounts and bounded memory/admission release.                                                         |
| Sharing             | Guessing IDs, old-revision references, notebook moves, expiry/revoke during reads, Range/HEAD denial and no third-party/auth/model traffic on anonymous readers.                                                                                                             |
| Export/recovery     | Extract archive and compare checksums, safe paths/remapping, real PDF image inspection, source changes during assembly, missing bytes, retained tombstones and no revived shares/jobs after restore.                                                                         |
| Audio/speech        | Microphone permission/fallback/track cleanup, codec playback/seeking, transcript edits, lost replies, two-worker lease races, disable/re-enable/profile changes, provider failure/budget/cancel and exact cache expiry.                                                      |
| Browser/performance | Chromium plus focused iPhone/WebKit at desktop/390/320px; keyboard/IME, paste/drop, autosave/first-save/Undo, focus and accessibility; reviewed captures; no binary/codecs/PDF renderer in initial Notes chunks. Physical device recording remains a separate qualification. |

For each slice run root lint/types/build/artifacts, relevant real database/storage
tests, website lint/types/build/bundle budgets and affected browser journeys using
[disposable verification services](testing.md). Run release/deployment contracts
and workflow lint when modifying those paths. Require successful exact-head CI,
not recovered test claims. Update API, workspace, sharing, models, storage/deploy,
backup and delivery documentation in the slice that changes their behavior.

Local execution records live in `~/Development/bramble-labs/plans/grove/`
(`plan.md`, `notes.md`, `status.md`); recovered `sources/` remain unchanged.
Work in `~/Development/bramble-labs/worktrees/` without taking over another
workstream's checkout. After an authorized PR merge, confirm its exact merge state,
preserve unrelated/uncommitted files and remove only its now-stale clean worktree.
