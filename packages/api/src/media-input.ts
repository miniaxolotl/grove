import { Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GroveError } from "@lib/shared/contracts";
import { imageLimits } from "@lib/shared/media";

/** A fixed allocation bounds memory independently of incoming chunk count. */
export async function readMediaBytes(source: Readable, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = Buffer.allocUnsafe(imageLimits.bytes);
  let size = 0;
  await pipeline(
    source,
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        if (chunk.length > input.length - size)
          return done(
            new GroveError(
              "media_too_large",
              "Media exceeds the upload size limit",
              413,
            ),
          );
        chunk.copy(input, size);
        size += chunk.length;
        done();
      },
    }),
    { signal },
  );
  signal.throwIfAborted();
  // Only initialized bytes escape; small objects do not retain the full buffer.
  return Buffer.from(input.subarray(0, size));
}
