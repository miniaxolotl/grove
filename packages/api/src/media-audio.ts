import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { GroveError } from "@lib/shared/contracts";
import { readMediaBytes } from "./media-input.ts";

/** PCM WAV is deliberately the only initial recording interchange format. Full
 * sample layout is checked; no remote URLs, playlists, codecs or decoder subprocess. */
export async function verifyAudio(source: Readable, signal: AbortSignal) {
  const fail = () =>
    new GroveError(
      "invalid_audio",
      "Use a PCM16 WAV recording up to 60 seconds",
      400,
    );
  const bytes = await readMediaBytes(source, signal),
    size = bytes.length;
  if (
    size < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) !== size - 8
  )
    throw fail();
  let rate = 0,
    alignment = 0,
    data = 0,
    formats = 0,
    payloads = 0,
    offset = 12;
  while (offset + 8 <= size) {
    const kind = bytes.toString("ascii", offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (length > size - start) throw fail();
    if (kind === "fmt ") {
      if (
        ++formats !== 1 ||
        length !== 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        bytes.readUInt16LE(start + 14) !== 16
      )
        throw fail();
      const channels = bytes.readUInt16LE(start + 2);
      rate = bytes.readUInt32LE(start + 4);
      alignment = bytes.readUInt16LE(start + 12);
      if (
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 48000 ||
        alignment !== channels * 2 ||
        bytes.readUInt32LE(start + 8) !== rate * alignment
      )
        throw fail();
    } else if (kind === "data") {
      if (++payloads !== 1) throw fail();
      data = length;
    }
    offset = start + length + (length % 2);
  }
  if (
    offset !== size ||
    formats !== 1 ||
    payloads !== 1 ||
    !data ||
    data % alignment !== 0
  )
    throw fail();
  const durationMs = Math.ceil((data / alignment / rate) * 1000);
  if (durationMs > 60000) throw fail();
  signal.throwIfAborted();
  return {
    bytes,
    mime: "audio/wav" as const,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: 0,
    height: 0,
    durationMs,
  };
}
