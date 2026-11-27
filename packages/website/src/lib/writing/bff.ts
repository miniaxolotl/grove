export const proofingRoute = (path: string, method: string) =>
  (path === "proofing/consent" && (method === "GET" || method === "PUT")) ||
  (path === "proofing/check" && method === "POST");

/** Check the actual byte count, including chunked bodies without Content-Length. */
export async function boundedProofingBody(
  stream: ReadableStream<Uint8Array> | null,
  maximum = 16_384,
) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
