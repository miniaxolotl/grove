import { InferenceError } from "./index.ts";
import { speechLimits } from "@lib/shared/speech";

/** Count decoded MPEG Layer III samples, ignoring untrusted Xing/VBR duration tags.
 * Bounded provider responses only; unsupported/truncated streams fail closed. */
export function mp3DurationMs(bytes: Buffer): number {
  const invalid = () => new InferenceError("provider_invalid_audio", false);
  if (!bytes.length || bytes.length > speechLimits.audioBytes) throw invalid();
  let offset = 0,
    end = bytes.length,
    seconds = 0,
    frames = 0;
  if (bytes.subarray(0, 3).toString() === "ID3") {
    if (
      bytes.length < 10 ||
      ![2, 3, 4].includes(bytes[3]) ||
      bytes.subarray(6, 10).some((value) => value & 0x80)
    )
      throw invalid();
    const size =
      bytes[6] * 0x200000 + bytes[7] * 0x4000 + bytes[8] * 0x80 + bytes[9];
    offset = 10 + size + (bytes[3] === 4 && bytes[5] & 0x10 ? 10 : 0);
  }
  if (end >= 128 && bytes.subarray(end - 128, end - 125).toString() === "TAG")
    end -= 128;
  while (offset < end) {
    if (
      offset + 4 > end ||
      bytes[offset] !== 0xff ||
      (bytes[offset + 1] & 0xe0) !== 0xe0
    )
      throw invalid();
    const version = (bytes[offset + 1] >> 3) & 3;
    const layer = (bytes[offset + 1] >> 1) & 3;
    const rate = (bytes[offset + 2] >> 2) & 3;
    const bitrateIndex = bytes[offset + 2] >> 4;
    if (
      version === 1 ||
      layer !== 1 ||
      rate === 3 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15
    )
      throw invalid();
    const sampleRate =
      [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate =
      (version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[
        bitrateIndex
      ] * 1000;
    const frameBytes =
      Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) +
      ((bytes[offset + 2] >> 1) & 1);
    if (offset + frameBytes > end) throw invalid();
    seconds += (version === 3 ? 1152 : 576) / sampleRate;
    offset += frameBytes;
    frames++;
  }
  if (!frames) throw invalid();
  return Math.ceil(seconds * 1000);
}
