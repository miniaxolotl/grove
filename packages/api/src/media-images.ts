import { createHash } from "node:crypto";
import { Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { GroveError } from "@lib/shared/contracts";
import { imageLimits, type ImageMime } from "@lib/shared/media";

export type VerifiedImage = {
  bytes: Buffer;
  mime: ImageMime;
  sha256: string;
  width: number;
  height: number;
};
const invalid = () =>
  new GroveError(
    "invalid_image",
    "Use a valid static PNG, JPEG or WebP image",
    400,
  );
const tooLarge = () =>
  new GroveError(
    "media_too_large",
    "Image exceeds the upload or decoded-size limit",
    413,
  );

function signature(bytes: Buffer): ImageMime | null {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

function staticPng(bytes: Buffer) {
  // libvips decodes only the first APNG frame and does not report `pages`.
  // Inspect actual chunk boundaries, not a substring in arbitrary metadata.
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") throw invalid();
    if (type === "IEND") return;
    offset += length + 12;
  }
  throw invalid();
}

/** Consume actual bytes with backpressure/cancellation, then fully decode a bounded
 * raster. Callers must acquire upload/decoder admission before entering this method.
 * Originals (including EXIF) are retained unchanged; this is not a metadata scrubber.
 */
export async function verifyImage(
  source: Readable,
  declaredMime: string,
  signal: AbortSignal,
): Promise<VerifiedImage> {
  signal.throwIfAborted();
  // A list of arbitrary input chunks is NOT bounded by the byte limit: millions
  // of one-byte chunks retain hundreds of MiB of Buffer/array object overhead.
  const input = Buffer.allocUnsafe(imageLimits.bytes);
  let size = 0;
  await pipeline(
    source,
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        if (chunk.byteLength > imageLimits.bytes - size)
          return done(tooLarge());
        chunk.copy(input, size);
        size += chunk.byteLength;
        done();
      },
    }),
    { signal },
  );
  signal.throwIfAborted();
  // Copy only initialized bytes, so small retained images do not keep 10 MiB alive.
  const bytes = Buffer.from(input.subarray(0, size));
  const mime = signature(bytes);
  if (!mime || declaredMime !== mime) throw invalid();
  if (mime === "image/png") staticPng(bytes);
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: imageLimits.pixels,
  });
  try {
    const meta = await image.metadata();
    signal.throwIfAborted();
    const expected = {
      "image/png": "png",
      "image/jpeg": "jpeg",
      "image/webp": "webp",
    }[mime];
    if (meta.format !== expected || (meta.pages ?? 1) !== 1) throw invalid();
    if (!meta.width || !meta.height) throw invalid();
    if (
      meta.width > imageLimits.dimension ||
      meta.height > imageLimits.dimension ||
      meta.width * meta.height > imageLimits.pixels
    )
      throw tooLarge();
    // Metadata alone accepts truncated images. Stats forces actual pixel decoding.
    await image.stats();
    signal.throwIfAborted();
    return {
      bytes,
      mime,
      width: meta.width,
      height: meta.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof GroveError) throw error;
    throw invalid();
  } finally {
    image.destroy();
  }
}
