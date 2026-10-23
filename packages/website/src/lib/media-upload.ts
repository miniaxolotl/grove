import { mediaReferenceId, mediaMimeTypes } from "@lib/shared/media";
import { mediaSource } from "./media-path";

/** Keep retry identity with the File while an uncertain response is retried. */
const identities = new WeakMap<File, string>();
export async function uploadMedia(
  file: File,
  note: { id: string; version: number },
  signal: AbortSignal,
) {
  if (!file.size || file.size > 3 * 1024 * 1024)
    throw new Error("Choose a file no larger than 3 MiB.");
  const mime = file.type === "audio/x-wav" ? "audio/wav" : file.type;
  if (!(mediaMimeTypes as readonly string[]).includes(mime))
    throw new Error(
      "Choose a static PNG/JPEG/WebP image or PCM16 WAV recording.",
    );
  const id = identities.get(file) ?? crypto.randomUUID();
  identities.set(file, id);
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const response = await fetch(mediaSource(note.id, id), {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    body: file,
    signal,
    headers: {
      "Content-Type": mime,
      "X-Grove-Note-Version": String(note.version),
      "X-Grove-Content-Sha256": sha256,
      "X-Grove-Telemetry": "off",
    },
  });
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(result.error?.message ?? "Image upload failed. Try again.");
  if (mediaReferenceId(result.data?.reference ?? "") !== id)
    throw new Error("Invalid upload response");
  return `${mime === "audio/wav" ? "" : "!"}[${file.name.replace(/[[\]\\\r\n]/g, " ").slice(0, 100) || "Attachment"}](${result.data.reference})`;
}
