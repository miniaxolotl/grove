# Recordings

Open **Add media → Record audio** in a saved note. Microphone access starts only
after that action. **Stop and attach** creates an original PCM WAV file; **Cancel
recording**, leaving the editor or signing out stops its tracks. Recording stops
automatically at60 seconds. Unsupported microphone/worklet environments can use
**Upload recording** instead. Capture is mono16kHz PCM16; no speech provider is
required and nothing is sent for inference automatically.

Uploads initially support **PCM16 WAV only**, mono/stereo8–48kHz, at most60 seconds,
3MiB through the website or10MiB through the API. Compressed WAV, MP3, AAC/M4A,
playlists and malformed/truncated files are refused. Original accepted bytes and
checksums are preserved. A WAV reference is a standard Markdown link to an opaque
attachment ID; images retain Markdown image syntax. Both use the same private
upload, quota, revision-binding and retained-deletion services.

The embedded player is user-started and supports authenticated single byte ranges,
HEAD, seeking and private/no-store responses. Invalid or multiple ranges return416.
Its compact inline controls share the workspace typography, forest colour and
spacing: play/pause, a slim seek track, elapsed/total time, 0.75–2× speed and mute.
Controls support keyboard use, visible focus and 44px buttons; touch seeking has
a 44px target. Loading and failed playback stay inline, with an explicit retry.
The enhanced player attaches its source only on Play (including in WebKit), stops
on unmount/source changes and never starts automatically. Public readers retain
native audio controls when JavaScript is disabled or before hydration.
Current editor audio URLs stay stable through note autosaves; historical readers
request their exact bound revision. Public links expose current saved audio only,
with the same live authorization/revocation checks as images and no automatic play.

## Transcripts

Expand **Transcript** to add or edit text, then **Save transcript**. Changes have
their own version and retry identity, with retained transcript revisions. A stale
save requires review/reload instead of overwriting newer text. **Use in note**
inserts the draft transcript through the ordinary editor Undo/autosave path; it
does not silently replace authored prose. Transcripts are private unless explicitly
inserted into the shared note text. Automatic STT is the following speech slice.

- `GET /v1/memories/:noteId/media/:id/transcript` reads the current transcript.
- `PATCH` on the same route accepts `{operationId,expectedVersion,text}` (≤6000
  characters) from the owning website session. Original audio is immutable.
- Image/audio reads share the existing authorized media route; `Range: bytes=a-b`
  supports206/416, and HEAD does not open a storage stream.

**Note with media (.tar)** includes original WAV files and current transcript text
sidecars. It fails if the note/transcript changes while streaming. Media-complete
NDJSON includes paged `media_binding` and `media_transcript_revision` records;
revision lists are not loaded into one unbounded object header. PDF keeps recording
links as text and embeds only actual Markdown images, so audio does not enter the
raster decoder. Database/bucket recovery preserves transcript histories and original
audio behind current account/note authorization.

Apply forward **018 `20261023_018_recordings`** after017 before API/worker. The same
private Spaces source bucket holds originals; no new media key or source lifecycle
is needed. Runtime readiness verifies recording/transcript schema when storage is
enabled. [Image storage and rollout](media.md) remain authoritative.

Implementation shares a fixed-capacity input reader, media MIME/reference catalog,
upload/insertion path, URL construction and streaming authorization with images.
WAV and raster validation remain format-specific. The recorder/worklet is loaded
only after an explicit action, outside the initial Notes entry bundle.

[Reviewed synthetic captures](design/screenshots/recordings/README.md) cover active
capture, custom playback/transcript at1440/390/320px, public reading, native no-JS
playback and forced colours. Browser synthetic devices verify the
capture/cleanup path; physical device microphones and OS permission UX need their
own qualification.
