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
3. In a saved, unchanged note's Preview, open **Read aloud**, then **Prepare audio**
   with your remembered voice. **Reed · Basic** is the initial default; **Willow**,
   **Cedar** and **Brook** are additional nature-named voices when available.
   When ready, use the same minimalist player as recordings. Playback is a separate
   user gesture; its voice is explicitly identified as AI-generated. The narration
   uses a CommonMark syntax tree: code (including indented/nested/unfinished fences),
   images, raw HTML nodes, owned-media references and link definitions are silent.
   Ordinary link labels remain prose, without sending their destinations or titles.

To change the voice, open **Read aloud options** (`⋯`) → **Change voice**. The
**Choose a voice** dialog contains the descriptions, radio choices and samples.
Browsing or dismissing it leaves the preference and prepared narration intact.
**Use voice** remembers the confirmed choice for your account. Confirming the same
voice preserves narration; confirming a different voice stops old playback and
attempts cancellation of unfinished work. It never prepares or plays new audio
automatically. A failed preference save keeps the applied local voice and offers
**Retry saving voice** beside the player.

In **Settings → Preferences → Speech**, **Reading voice** shows the current name
and **Change** only while Read aloud is enabled. The same chooser updates the form
draft; **Save preferences** persists it and **Discard changes** restores the saved
choice. Turning Read aloud off hides the summary without clearing the voice.
An unavailable remembered voice stays selected until you choose another. Read aloud
offers **Change voice** when alternatives are available; Settings can still remember
an unavailable choice. Errors never silently route notes to a different voice/service.

The play icon beside a voice loads a fixed same-origin sample only on request,
without sending note content or enabling speech. The bundled Willow/Cedar/Brook samples are
AI-generated from synthetic editorial text. Reed currently has no bundled sample;
its installation-specific `TTS_VOICE` mapping is retained. Samples and narration
share playback ownership, so starting one pauses the other. Each sample button is
independent of the radio selection and never saves a preference. Dismissing the
chooser stops samples and leaves narration paused at its retained position.

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

| Role                   | Selected model             | Input                                                             | Output                                                                  |
| ---------------------- | -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Transcription          | OpenAI `whisper-1`         | Immutable, checksum-verified original PCM16 WAV, up to 60 seconds | Suggested text, up to 6,000 characters; language detected automatically |
| Reed · Basic           | OpenAI `tts-1`             | Saved narration text, up to 3,000 UTF-16 units                    | MP3, at most 3 MiB; `TTS_VOICE`, default `alloy`                        |
| Willow / Cedar / Brook | MiniMax `speech-2.8-turbo` | The same bounded narration                                        | Mono MP3, 32 kHz / 64 kbps, at most 3 MiB                               |

MiniMax mappings are `English_CalmWoman` (Willow), `English_ManWithDeepVoice`
(Cedar) and `English_Upbeat_Woman` (Brook). These are curated system presets;
Grove creates no custom or cloned voices. MiniMax speech explicitly reuses the
server-only `MINIMAX_API_KEY` through `/v1/t2a_v2`, independently gated by
Vercel's `minimax-tts-enabled` flag when `FLAGS` is configured, or the self-hosted
`MINIMAX_TTS_ENABLED` opt-in otherwise. OpenAI continues to use `OPENAI_API_KEY`. There is no provider
fallback. Credentials, audio, note text, transcripts and upstream diagnostics do
not enter application telemetry. Both fixed endpoints disallow redirects, bound
streamed responses and have a 45-second provider deadline. MiniMax additionally
checks HTTP-success body errors, final status, strict hexadecimal encoding and the
decoded MP3 bound. Parenthetical text becomes bracketed prose and numeric pause
tags become bracketed numbers, preventing provider pronunciation/interjection and
pause controls. Optional LLM text normalization is not requested.
Do not interpret a configured key as a successful health or billing check.

According to [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data)
(checked 23 October 2026), API inputs are not used for training unless the customer
opts in. The endpoint table lists no application-state or abuse-monitoring retention
for `/v1/audio/transcriptions`; `/v1/audio/speech` has no application state but
normally up to 30 days of abuse-monitoring retention, subject to the provider's
exceptions. Grove does **not** claim this account has approved Zero Data Retention,
regional processing or additional contractual controls. Already transmitted data
cannot be recalled by cancellation, disabling a preference or deleting a note.

[MiniMax's API privacy policy](https://platform.minimax.io/protocol/privacy-policy)
(effective 30 March 2026, checked 24 October 2026) covers inputs and outputs,
describes US data-center storage and cross-border processing, and permits retention
as necessary for service purposes or law; it gives no fixed speech-request retention
period. Its [terms](https://platform.minimax.io/protocol/terms-of-service) permit
using input/generated content to provide, maintain, develop and improve services.
OpenAI's endpoint-specific retention statements above do not apply to MiniMax.
No account-specific no-training, zero-retention or regional-processing agreement
has been established by this implementation.

## Queue, limits and freshness

Both tasks use the existing **bulk** lane, fair claims, token-fenced 120-second
renewable task leases, bounded automatic retries and conservative inference
reservations. Bulk work admits one task per account. Separate database-backed
provider slots default to two across replicas (`SPEECH_PROVIDER_CONCURRENCY`, 1–16);
90-second slots outlast the 45-second provider deadline, including crash recovery.
The complete handler also has a 60-second cooperative deadline.

Each account/role reserves at most 20 attempts/day. Unconfigured/flag-off and
self-hosted installations additionally cap original duration at 600 seconds/day
and synthesis at 60,000 text units/day, with the original total-AI guard.
Flagged Cloud instead uses **2 hours Free / 8 hours Pro per month independently
for transcription and read aloud**, with separate non-generation daily AI admission.
Input recording, text, byte and deadline bounds above still apply; these quotas do
not add long-recording ingestion or full-lecture narration.

Migration **026 `20261025_026_speech_duration`** adds duration accounting alongside
retained character counters. Workers reserve conservative MP3 duration before send,
then settle to measured decoded frame duration only with successful, fresh output.
MPEG headers are parsed across all frames; claimed Xing duration and character-rate
estimates do not decide quota. Invalid/truncated/unsupported output fails closed.
Retries, uncertain calls and failed publication retain their duration reservations;
cancellation does not promise a refund. Historical/old-writer attempts whose
duration is unknown are conservatively bounded rather than reset. Cached/replayed
audio costs no new allowance. See [billing](billing.md) for exact reservation,
upgrade and reset semantics. These are inference bounds, not a guaranteed dollar
bill or an installation-wide spending limit.

All four voices share the same synthesis allowance and provider slots. Selecting
another voice does not create a separate quota.

Every send/publication/read checks current account and session authorization,
active/unexpired note, exact source revision and audio binding/checksum,
transcript version, preference generation, installation provider profile and
restore epoch. Disable/re-enable, edited sources, provider/key/voice or narration
profile changes,
revocation and lost leases cannot publish or revive an old result. Worker guards
check during inference and propagate cancellation. Speech opt-ins do not reschedule
unrelated organization work.

The remembered voice is a future-request default, not a consent generation. A
voice-only save neither cancels another tab's audio nor invalidates the account's
cache. A→B→A can reuse A's matching unexpired audio. Each task freezes its resolved
Grove voice and provider profile; an omitted-voice retry keeps that resolution even
after the default changes. Reusing an operation ID with different explicit inputs
is rejected. Per-voice profile checks mean a MiniMax cutover leaves Reed valid.

## Temporary output and recovery

Before migration 024, generated MP3 used `speech/ACCOUNT/TASK/ATTEMPT.mp3` in the
**artifact store**, never the retained source-media store. Objects are tracked before writing
in the existing artifact cleanup registry; failed writes remain cleanup candidates.
Legacy objects keep their original expiry. New generated MP3 uses
`narration/ACCOUNT/TASK/ATTEMPT.mp3` in the same private S3 artifact store, on a
prefix **without an age-based bucket lifecycle**. Self-hosting can use the same
local artifact adapter. Successful publication stores the SHA-256 of the exact
saved UTF-8 note text alongside the audio checksum and a cache identity containing
tenant, note, text hash, provider/model/voice/format, preference generation and
restore epoch. It does not store another copy of the note text.

Matching audio has no age expiry while the note is active and unexpired. A text
change starts a **seven-day** retention window for the superseded audio; subsequent
different edits do not extend that window. Reverting to the original text before
expiry reuses its audio without another provider call and removes its stale deadline.
Metadata-only revisions also reuse matching text. Voices have independent cache
entries. An expired entry cannot be revived, even if cleanup has not removed it yet.
Archiving/deleting a note starts the same grace window; a scheduled note expiry
bounds audio retention to seven days after that expiry. Failed/unpublished writes
remain one-day cleanup candidates.

Task/candidate access expires no later than 24 hours after enqueue. A cache hit
creates a fresh retry-safe receipt for the current revision/session without
extending an old receipt's authorization window. Cache metadata survives receipt
and machine-result expiry. Worker maintenance clears expired machine-result text
in bounded batches, and artifact cleanup claims expired objects irreversibly before
removing their bytes. Matching audio is excluded. Physical deletion depends on
running maintenance; expiry is not an exact deletion-time promise. Playback uses private/no-store authenticated Range/HEAD
streams with renewed authorization, not raw S3 URLs. Delivered bytes cannot be revoked.

Accepted, saved transcripts are retained authored data and already belong to the
recording's transcript history, TAR sidecars and media-complete exports. Unaccepted
candidates and generated MP3 are not portable source data. Restore reconciliation
cancels unfinished jobs, clears speech results and expires tracked artifacts; old
speech is never replayed automatically. Original WAV and accepted transcript history
remain intact. See [recordings](recordings.md) and [jobs](jobs.md).
Account backup/restore retains the remembered voice; reconciliation replays its
current value while expiring derived speech from every voice.

## Installation and API

Apply the forward migrations through **026 `20261025_026_speech_duration`**, including
024 `20261024_024_speech_cache` after 023, using the owner
procedure in [deploy](deploy.md). Configure API and worker identically:

```sh
SPEECH_ENABLED=true
OPENAI_API_KEY=YOUR_SERVER_KEY
TTS_VOICE=alloy
MINIMAX_TTS_ENABLED=false
SPEECH_PROVIDER_CONCURRENCY=2
```

The installation flag defaults false. STT needs the original media store; TTS needs
temporary artifact storage. Cloud must keep the private durable media bucket
separate from the artifact bucket; existing `speech/` and export expiry rules must
not cover `narration/`. Local storage is for self-hosting/tests. Reed's
`TTS_VOICE` override accepts `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`.
To activate Willow/Cedar/Brook in Cloud, configure the same environment's server-only
Vercel `FLAGS` SDK key and `MINIMAX_API_KEY` on API and worker, then enable the global
boolean flag `minimax-tts-enabled`. It defaults false in code and controls the three
voices independently from billing, Reed and transcription. With `FLAGS` configured,
the legacy `MINIMAX_TTS_ENABLED` opt-in is ignored; without it, self-hosting continues
to use that environment toggle. Both modes still require speech and artifact storage.

Providers remain registered while the flag is off. Runtime SDK streaming/polling
refreshes the decision without a restart; changes take effect as each replica receives
them, not atomically across replicas. Availability, request/replay/cache access,
worker dispatch and result publication recheck the decision. Missing/error decisions
deny alternate voices, with no stale-on-error grace or silent Reed fallback. Pausing
does not delete matching audio; re-enabling can reuse it under the normal guards.
This is an installation-wide flag, not a per-user targeting contract. The website's
authenticated Flags Explorer discovery advertises the same key.
API startup publishes per-voice profiles plus the `speech-content-cache-v1` protocol
marker. Older/mismatched workers fail closed; legacy TTS tasks without a voice
identity require starting again. Transcription keeps its independent profile.
Runtime startup verifies the new account/configuration schema. Initial/image-only
hosting operations do not infer missing speech secrets or activate the new flag.
Drain older API/worker instances before publishing the content-cache protocol;
do not restart an old API that republishes obsolete single-voice configuration.
Verify `narration/` has no bucket-wide/prefix age expiry and has private GET/PUT/DELETE
permission; keep one-day expiration scoped to exports and legacy `speech/` only.
Migration 021 changes defaults for future accounts, never existing choices;
022 retains remembered voices, and 024 preserves old artifacts' existing deadlines.
Use [schema upgrades](operations/schema.md) and coordinate API/worker/site units
with [billing rollout](billing.md#rollout-and-verification). Keep schema and saved
choices on rollback; disable alternate voices rather than deleting audio or keys.

- `GET /v1/me`: includes `transcriptionEnabled`, `readAloudEnabled`,
  `readAloudVoiceId`, `speechVoices: [{id,name,description,basic,available,sampleId?}]`
  and `speechAvailable: {transcription,synthesis}`. Synthesis means at least one
  voice passes the installation/storage gates, not a live health check.
- `PATCH /v1/account/settings`: accepts `readAloudVoiceId` independently of boolean
  preferences. Only `reed`, `willow`, `cedar`, `brook` are accepted, including known
  choices whose providers are temporarily unavailable.
- `POST /v1/memories/:noteId/speech`: `{id,version,mediaId?,voiceId?}`. With `mediaId`,
  queue transcription and reject `voiceId`; otherwise resolve the explicit voice
  or saved default and queue read aloud. Returns 202 and the safe task view.
  Reuse `id` to recover an uncertain response; a deliberate retry uses a new UUID.
- `GET /v1/speech/:id`: safe status, synthesis `voiceId`, optional suggested `transcript`, `playable`
  and a sanitized error code; no object key, token or provider diagnostic.
- `POST /v1/speech/:id/cancel`: `{}`; fences unfinished work.
- `GET`/`HEAD /v1/speech/:id/audio`: authorized MP3, with single byte-range
  206/416 handling. Source changes/expiry make audio unavailable.

[Verification and reviewed synthetic captures](design/screenshots/speech/README.md).
[Selectable voices, sample provenance and captures](design/screenshots/speech-voices/README.md).
[On-demand chooser and compact playback captures](design/screenshots/speech-voice-flow/README.md).

## Verification

Run the `speech-*.test.ts` suites and `recovery.test.ts` with
[disposable non-owner services](development/testing.md). They cover actual adapter
response bounds/abort, exact voice routing, duration reservations, source/profile/
preference/session/lease fences, cache A→B→A, receipt-independent lifetime, stale-only
cleanup, failed writes and populated 019/021/022/024/026 retention. The loopback S3
test checks requests, not live bucket policy. No personal audio/provider call is
needed for these deterministic cases.

Use actual components in Chromium and touch/mobile WebKit. Browsing/cancelling the
chooser must not request samples, save preferences or generate narration. Sample
playback is explicit and independent from selection; same-voice confirmation keeps
the player/position, different voice cancels old work without preparing new audio.
Check held/failed saves, newer drafts, lost enqueue replies, both close controls,
in-app navigation and uncertain cancellation. Settings discard and unavailable
saved voices must remain honest, without fallback. Test 1440/390/320px, short
windows, focus/native radio keys and accessible playback. Hard exits cannot promise
cancellation. Live voice/language quality and long-note fatigue remain separately
unqualified; a decoded MP3 or synthetic response is not listening acceptance.
