# Read-aloud voice samples

AI-generated examples created on 24 October 2026 using MiniMax's system presets
and Grove's `createMiniMaxSpeech` adapter. These contain only this fixed synthetic
editorial text, never personal notes:

> Take a moment to notice what is growing. Keep a small thought, follow an
> interesting idea, and return to it when you are ready.

## Generation settings

- Endpoint: `POST https://api.minimax.io/v1/t2a_v2`
- Model: `speech-2.8-turbo`; nonstreaming, hex response, `language_boost: auto`
- Voice settings: speed `1`, volume `1`, pitch `0`
- Audio: MP3, mono, 32,000 Hz, 64,000 bits/second
- Optional text normalization omitted. The sample text contains no provider
  interjection, pronunciation or pause notation.

| File                           | System preset              |  Bytes | Duration | Generation time |
| ------------------------------ | -------------------------- | -----: | -------: | --------------: |
| [willow-v1.mp3](willow-v1.mp3) | `English_CalmWoman`        | 68,244 |  8.313 s |         2.048 s |
| [cedar-v1.mp3](cedar-v1.mp3)   | `English_ManWithDeepVoice` | 64,788 |  7.849 s |         1.583 s |
| [brook-v1.mp3](brook-v1.mp3)   | `English_Upbeat_Woman`     | 62,484 |  7.593 s |         1.687 s |

SHA-256:

```text
1bf3ac67e6debeec56d8f4a4b004b6b27d7f5d1fcbab5e2c4a7d02f247049392  willow-v1.mp3
aae75ffc4df93c09f248fa8351edab9e1fa8327dc52297c04054e19b5894e408  cedar-v1.mp3
421227fa25fe953ae54cdb48b751d54bc9f065cadb0842ab92530d5447996b07  brook-v1.mp3
```

System-list lookup confirmed all three IDs. `ffprobe` verified the format above;
`ffmpeg` decoded each file without errors, and both Chromium and iPhone/WebKit
played samples through the actual component. This verifies transport and playback,
not subjective listening or language quality.

Reed has no bundled sample: OpenAI credential access was unavailable during this
qualification. Its existing `tts-1` / installation-specific `TTS_VOICE` behavior is
retained. Do not advertise another voice's recording as a Reed sample.

Runtime advertises these assets only for the matching registered presets. Keep
mapping, model and settings aligned; a changed recording needs a new sample ID.
See [speech processing and retention](../../../../documentation/speech.md).
