# Images and durable media

**[Files & storage](files-storage.md)** lists private document uploads, images and
original recordings with their note/notebook/chat locations and storage budgets.

Reviewed [document imports and Ask attachments](imports.md) retain accepted PDF,
DOCX, Markdown and text originals through
the same immutable source store, with a separate document-only validation method.
They do not widen image/WAV note attachment endpoints or public media readers.
Imports share the account's retained-byte/attempt safety budget. Media-complete
exports also include original-document records; unconfirmed database staging expires
separately and never enters source-object deletion.

Chat documents are independent of saved-note image/WAV media: uploading or asking
creates no library note. Send/save accepts private retained originals; Remove and
chat deletion revoke chat use without deleting originals. Explicitly saved generated
notes retain separate owner-session-only source bindings. Neither these bindings
nor notebook sharing publish original documents. Unaccepted staging/excerpts expire
after24 hours, under a shared75 MiB account staging ceiling. See the
[document lifecycle/API](imports.md#ask-about-documents-first).

Images attach to saved notes. Choose **Add media → Add image**, paste an image or drop a file
into the editor after the note and its changes have saved. The website accepts
static PNG, JPEG and WebP up to **3 MiB** (within the hosted proxy request budget).
The API supports **10 MiB**, 24 million decoded pixels and 10,000 pixels per axis.
SVG, APNG, animated WebP and invalid/truncated images are refused.

Drop a file anywhere in the note workspace (including its surrounding whitespace)
to upload at the nearest writing position or preview paragraph boundary. Drag an
existing preview image to move its reference, or use **Move up / Move down** with
keyboard or touch. Moves are one Undo transaction and use ordinary autosave; they
do not upload another copy or erase retained history. A drag is accepted only from
the same mounted editor and unchanged source range. Drop one new file at a time.

Upload progress offers cancellation; an uncertain retry retains its upload ID.
After upload, insertion is one editor Undo transaction and uses normal autosave and
version conflict handling. Original bytes and metadata, including EXIF, are retained:
consider their contents before sharing. External images remain click-to-open links.
New notes must finish their ordinary first save; uploading never creates a blank
note or public link implicitly. Uploads are session-owner-only; scoped agents can
read attachments through an authorized saved note/revision but cannot upload them.

## Access and retention

Canonical `grove-media:<UUID>` references identify an attachment, not permission.
Each object belongs to one tenant and saved note. Every authored revision validates
references transactionally and records bindings. Copying an ID into a different
note, tenant or generated proposal cannot transfer access; upload the file in the
destination note. History and comparison can render older bound images while that
note remains accessible. Removing an image from current text preserves its history.

Private reads enforce the current session/connection grant and notebook scope.
Public reads use live link scope/expiry and **only current-revision bindings**;
private history is never exposed by a public link. Moves, expiry, revocation and
deletion remove new access. Responses are private/no-store with nosniff/no-referrer.
Previously delivered bytes cannot be recalled. Public images work without JS and
do not load Clerk, inference or third-party image URLs.

Objects, upload-attempt identities and revision bindings are retained. No source
deletion method is exposed to export cleanup. Each actual write attempt reserves
its declared bytes and one object slot under the account lock, initially capped at
**1 GiB / 1,000 attempts**. Failed or uncertain attempts remain charged because
storage may have accepted bytes; they cannot silently produce untracked free
objects. Unstarted retries do not consume another reservation. Quota reclamation
requires a separately designed owner operation; deleting notes does not reclaim
retained originals. Upload leases expire after 120 seconds and stale completion
cannot publish. No storage/network transfer holds a DB transaction.

## API

- `PUT /v1/memories/:noteId/media/:id`: owning session; raw verified image body,
  `Content-Type`, accurate `Content-Length`, `X-Grove-Note-Version` and
  `X-Grove-Content-Sha256`. Stable client UUID identifies retries. Returns 201 for
  a newly accepted image or 200 for a completed replay, with a reference and safe
  dimensions/MIME/size, never a storage key. The following ordinary note save binds
  the returned reference. Concurrent or stale uploads return 409.
- `GET /v1/memories/:noteId/media/:id[?version=N]`: current authorized binding by
  default or an exact historical revision. No arbitrary object-key access.
- `GET /public/shares/:token/notes/:noteId/media/:id`: current public scope only;
  history query parameters do not widen access.
- `GET /v1/memories/:id/archive-file[?version=N]`: current saved snapshot as a
  streaming TAR. The version guard and ongoing rechecks reject changing sources.
- `GET /v1/me` includes `mediaAvailable`, determined by configured runtime storage.

Uploads/downloads use bounded interactive admission/deadlines. Ordinary JSON
requests retain their 128 KiB cap; image bodies use a separate actual-byte-limited
stream. The website proxy authenticates first and forwards binary streams with a
3 MiB cap. Deployed hosting limits must be verified separately at activation.

## Exports and recovery

**Note with images (.tar)** contains `note.md` with relative paths,
`media/<UUID>.<extension>` with byte-identical originals, and `manifest.json`
version1 with note identity/revision, MIME, sizes and SHA-256 checksums. Generated
paths prevent filename traversal. Save drafts first for this portable archive.
Missing/corrupt media or concurrent changes fail the stream rather than claiming a
complete archive. Plain Markdown/copy retains internal references and is labelled
accordingly. PDF embeds authorized raster images, resampled to at most 1,600 pixels
per axis with a 30 MiB source budget; original archives retain full bytes. PDF never
fetches external image URLs and remains deferred from the initial Notes bundle.

Account/notebook exports can select **Include original media** (`includeMedia:true`
on `POST /v1/exports`). Existing text exports remain v2 NDJSON. Media-complete
`grove.ndjson.v3` adds `media_object` metadata, separately paged `media_binding`
records and `media_chunk` records with UUID, byte offset and base64 data. Chunks decode to
at most 48 KiB, offsets are contiguous, and the reconstructed object must match
the metadata size/SHA-256. Assembly checkpoints one object at a time, verifies
integrity and retains export-version/lease fences and one-day artifact expiry.
Base64 is export transport only, never stored in authored note text. These exports
are portable records; the existing text-import endpoint does not import binaries.

Operator recovery must back up the private media bucket alongside PostgreSQL,
preserving immutable object keys and hashes. Restore bytes before enabling reads;
verify every ready object's size/checksum against the DB. A database-only snapshot
is not media-complete. Run the existing isolated restore reconciliation: pending
uploads become failed, ready originals stay immutable, and current tombstones and
revoked grants/shares are replayed. Never restart old upload leases or use exports
as an authoritative source of current permissions. Retained provider data is not
purged as part of recovery.

## Configuration and rollout

Apply forward migration **017 `20261023_017_media_attachments`** using the owner
procedure before API/worker. It is independent of pending notebook-lifecycle 016;
integrated installations still apply registered migrations in order. API and worker
need identical storage settings. `MEDIA_STORAGE=disabled` keeps uploads unavailable.
Cloud requires `s3`; it cannot fall back to local disk. Use private DigitalOcean
Spaces, `MEDIA_S3_ENDPOINT=https://<region>.digitaloceanspaces.com`, SDK signing
region `MEDIA_S3_REGION=us-east-1`, a private bucket and server-only scoped keys.
Keep temporary exports/speech separate. The factory rejects matching export/media
buckets, credentials and overlapping local roots. Compose forwards the settings
and offers a separate persistent local volume for self-hosting only.

Startup checks lifecycle and conditional-write behavior using a unique disposable
`media-probes/` object. Source keys never enter the probe deletion path. A provider
that ignores conditional PUT is refused; Garage2.4.1 is not supported for source
media. Spaces scoped keys deny lifecycle inspection: only for a regional Spaces
endpoint, an operator may set `MEDIA_S3_LIFECYCLE_VERIFIED_FOR` to the exact
`https://<region>.digitaloceanspaces.com/<bucket>` after independently inspecting
its private ACL and absence of expiration. This receipt permits only that specific
AccessDenied case; known expiration rules and failed conditional writes still fail.
Reverify the receipt after bucket/retention changes and before activation. Do not
put an account-wide Spaces credential in the API/worker to enable inspection.

Initial user-authorized NYC3 provisioning verified private source and temporary buckets,
source non-expiry, one-day exports/speech expiry, anonymous403, conditional412 and
cross-bucket scoped denial. Active keys are in Grove Doppler configs `prd_media`
and `prd_artifacts`, mirrored in the main checkout's ignored0600 `secrets.md`.
Temporary operator keys were revoked. Runtime configs were not activated and no
application deployment occurred. Hosting body limits and capability-log redaction
remain rollout checks. See [storage details](development/media-foundation.md),
[sharing limitations](sharing.md) and [deployment](deploy.md).

[Recordings](recordings.md) add original WAV playback and editable transcripts;
current [STT/TTS contracts](speech.md) include text-hash audio caching. Migration
024's `narration/` prefix must be excluded from the original one-day speech rule.
[Screenshots](design/screenshots/media-images/README.md) show synthetic
desktop/phone and export states; the PR uses three previews per row.
