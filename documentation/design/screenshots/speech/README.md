# Speech verification

Synthetic notes and a disposable real API/PostgreSQL/private storage fixture;
deterministic provider responses exercise the actual bulk worker handlers and
real MP3 playback. No personal recordings or account content are used.

| Transcription review                                        | Read aloud                                                | Phone                                   |
| ----------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| ![Separate suggested transcript](transcription-desktop.png) | ![Shared minimalist audio player](read-aloud-desktop.png) | ![390px read aloud](read-aloud-390.png) |

| Independent preferences                    | Narrow phone                          | Provider failure                    |
| ------------------------------------------ | ------------------------------------- | ----------------------------------- |
| ![Speech opt-ins](preferences-desktop.png) | ![320px playback](read-aloud-320.png) | ![Inline retry](provider-error.png) |

[Cancellation state](cancelled.png). Chromium and touch/mobile WebKit journeys
verify opt-in/no automatic inference, queued STT, explicit candidate replacement,
transcript save/use, generated playback, exact-source cache reuse without another
provider call, failure/retry, cancellation propagation,1440/390/320px bounds and
WCAG A/AA checks. The preview remains a document-only surface for editor shortcuts;
speech tools are siblings rather than authored Markdown content.

A separate bounded real OpenAI check synthesized **“Meet me by the river at three.”**
with tts-1/alloy (30336 MP3 bytes), converted only that synthetic output to PCM WAV,
then transcribed it with whisper-1 (60750 WAV bytes). The expected phrase was
recognized. This is API/codec integration evidence, not a general speech-quality
benchmark or a physical-device/microphone qualification. Credentials stayed in
ignored private custody; audio fixtures remain outside tracked source.
