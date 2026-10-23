import { mediaReferenceId } from "@lib/shared/media";

/** Keep retry identity with the File while an uncertain response is retried. */
const identities = new WeakMap<File, string>();
export async function uploadImage(
  file: File,
  note: { id: string; version: number },
  signal: AbortSignal,
) {
  if (!file.size || file.size > 3 * 1024 * 1024)
    throw new Error("Choose an image no larger than 3 MiB.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a static PNG, JPEG or WebP image.");
  const id = identities.get(file) ?? crypto.randomUUID();
  identities.set(file, id);
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  signal.throwIfAborted();
  const sha256 = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const response = await fetch(`/api/grove/memories/${note.id}/media/${id}`, {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    body: file,
    signal,
    headers: {
      "Content-Type": file.type,
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
  return `![${file.name.replace(/[[\]\\\r\n]/g, " ").slice(0, 100) || "Image"}](${result.data.reference})`;
}
