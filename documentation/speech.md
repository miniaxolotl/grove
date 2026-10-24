# Transcription and read aloud

Speech is an optional, session-owner-only feature. For new accounts, **Recording
transcription starts off** and **Read aloud starts on**, independently of other AI
choices. Existing saved choices are preserved. Neither opening a note nor enabling
a preference sends speech data. Audio preparation and playback still require
explicit actions. Original recordings, manual transcripts and ordinary editing
remain usable when speech is disabled or unavailable.

## Using speech

1. Choose **Recording transcription** and **Read aloud** in
   **Settings → Preferences → Speech**, then save. If a feature is off, its prompt
   names that feature and links to **AI preferences**. Unavailable features are
   identified without showing backend setup details. Availability reflects setup,
   not a successful health check or remaining quota.
2. In a current note's **Preview**, expand a recording's **Transcript** and choose
   **Transcribe**. The result appears as a **Suggested transcript**, separate
   from your draft. **Use transcription** (or **Replace draft with transcription**)
   explicitly copies it into the draft. **Save transcript** retains an authored
   version; **Use in note** uses normal editing, autosave and Undo. A background job
   never overwrites authored text or an edited transcript.
3. In a saved, unchanged note's Preview, open **Read aloud → Prepare audio**.
   When ready, use the same minimalist player as recordings. Playback is a separate
   user gesture; its voice is explicitly identified as AI-generated. The narration
   uses a CommonMark syntax tree: code (including indented/nested/unfinished fences),
   images, raw HTML nodes, owned-media references and link definitions are silent.
   Ordinary link labels remain prose, without sending their destinations or titles.

Queued/running work has **Cancel speech**. Failed jobs offer **Try again**; failed
status reads offer **Check again**, without starting another paid request. Closing
the note through in-app navigation makes a best-effort cancellation of unfinished
work, including a retry whose response has not arrived. Closing read aloud also
attempts cancellation after an unknown enqueue outcome instead of forgetting its
operation ID, and stops its player. Hard page exits/crashes cannot guarantee a
cancellation request. Newer source versions discard the old controls/results.
No anonymous reader or connected agent can generate or retrieve this derived audio.
Public links still play their separately authorized original recordings.

## Provider and privacy contract

The interface describes the feature, not its backend vendor. The privacy policy
explains the external processing, data sent, controls and retention without vendor
branding. The technical details below are for operators; see the
[product-copy guidance](development/product-copy.md) for user-facing wording.

| Role          | Selected model     | Input                                                             | Output                                                                  |
| ------------- | ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Transcription | OpenAI `whisper-1` | Immutable, checksum-verified original PCM16 WAV, up to 60 seconds | Suggested text, up to 6,000 characters; language detected automatically |
| Read aloud    | OpenAI `tts-1`     | Saved narration text, up to 3,000 characters                      | MP3, at most 3 MiB; default voice `alloy`                               |

No text-generation provider/key is reused as a fallback. `OPENAI_API_KEY` remains
server-only; credentials, audio, note text, transcript text and upstream diagnostics
do not enter application telemetry. Requests use the fixed OpenAI API endpoint,
disallow redirects, bound streamed responses and have a 45-second provider deadline.
Do not interpret a configured key as a successful health or billing check.

According to [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data)
(checked 23 October 2026), API inputs are not used for training unless the customer
opts in. The endpoint table lists no application-state or abuse-monitoring retention
for `/v1/audio/transcriptions`; `/v1/audio/speech` has no application state but
normally up to 30 days of abuse-monitoring retention, subject to the provider's
exceptions. Grove does **not** claim this account has approved Zero Data Retention,
regional processing or additional contractual controls. Already transmitted data
cannot be recalled by cancellation, disabling a preference or deleting a note.

## Queue, limits and freshness

Both tasks use the existing **bulk** lane, fair claims, token-fenced 120-second
renewable task leases, bounded automatic retries and conservative inference
reservations. Bulk work admits one task per account. Separate database-backed
provider slots default to two across replicas (`SPEECH_PROVIDER_CONCURRENCY`, 1–16);
90-second slots outlast the 45-second provider deadline, including crash recovery.
The complete handler also has a 60-second cooperative deadline.

Each account/role reserves at most 20 attempts/day. Transcription additionally caps
total original duration at 600 seconds/day; synthesis caps narration at 60,000 text
units/day (JavaScript UTF-16 length). Existing `AI_DAILY_REQUEST_LIMIT` also applies
across roles. Retries and uncertain calls retain their reservations; cancellation
does not promise a refund. These are inference bounds, not a guaranteed dollar bill
or an installation-wide spending limit.

Every send/publication/read checks current account and session authorization,
active/unexpired note, exact source revision and audio binding/checksum,
transcript version, preference generation, installation provider profile and
restore epoch. Disable/re-enable, edited sources, provider/key/voice or narration
profile changes,
revocation and lost leases cannot publish or revive an old result. Worker guards
check during inference and propagate cancellation. Speech opt-ins do not reschedule
unrelated organization work.

## Temporary output and recovery

Generated MP3 uses `speech/ACCOUNT/TASK/ATTEMPT.mp3` in the **temporary artifact
store**, never the retained source-media store. Objects are tracked before writing
in the existing artifact cleanup registry; failed writes remain cleanup candidates.
Cache reuse requires the same tenant, note/revision, provider/model/voice/format,
preference generation and restore epoch, plus an unexpired tracked object. Reuse
creates a retry-safe request receipt without another provider call.

Task/candidate access expires no later than 24 hours after enqueue; reused output
keeps the original deadline. Worker maintenance clears expired machine-result text
in bounded batches, and artifact cleanup removes expired objects. Physical deletion
depends on running maintenance or the operator's bucket lifecycle; expiry is not an
exact deletion-time promise. Playback uses private/no-store authenticated Range/HEAD
streams with renewed authorization, not raw S3 URLs. Delivered bytes cannot be revoked.

Accepted, saved transcripts are retained authored data and already belong to the
recording's transcript history, TAR sidecars and media-complete exports. Unaccepted
candidates and generated MP3 are not portable source data. Restore reconciliation
cancels unfinished jobs, clears speech results and expires tracked artifacts; old
speech is never replayed automatically. Original WAV and accepted transcript history
remain intact. See [recordings](recordings.md) and [jobs](jobs.md).

## Installation and API

Apply forward migration **019 `20261023_019_speech`** after 018, using the owner
procedure in [deploy](deploy.md). Configure API and worker identically:

```sh
SPEECH_ENABLED=true
OPENAI_API_KEY=YOUR_SERVER_KEY
TTS_VOICE=alloy
SPEECH_PROVIDER_CONCURRENCY=2
```

The installation flag defaults false. STT needs the original media store; TTS needs
temporary artifact storage. Cloud must keep the private durable media bucket
separate from the expiring artifact bucket; the existing `speech/` one-day lifecycle
belongs only on the latter. Local storage is for self-hosting/tests. Voice choices
are `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. API startup publishes desired
speech profiles; older/mismatched workers fail closed. Runtime startup verifies the
new account schema; this slice does not apply a production migration or activate
the flag. Initial/image-only hosting operations do not infer missing speech secrets.

- `GET /v1/me`: adds `transcriptionEnabled`, `readAloudEnabled` and
  `speechAvailable: {transcription,synthesis}`; normal settings PATCH updates either
  preference independently.
- `POST /v1/memories/:noteId/speech`: `{id,version,mediaId?}`. With `mediaId`, queue
  transcription; otherwise queue read aloud. Returns 202 and the safe task view.
  Reuse `id` to recover an uncertain response; a deliberate retry uses a new UUID.
- `GET /v1/speech/:id`: safe status, optional suggested `transcript`, `playable`
  and a sanitized error code; no object key, token or provider diagnostic.
- `POST /v1/speech/:id/cancel`: `{}`; fences unfinished work.
- `GET`/`HEAD /v1/speech/:id/audio`: authorized MP3, with single byte-range
  206/416 handling. Source changes/expiry make audio unavailable.

[Verification and reviewed synthetic captures](design/screenshots/speech/README.md).
