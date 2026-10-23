/** Dependency-free identifiers/limits; possession of a reference never grants access. */
export const imageLimits = {
  bytes: 10 * 1024 * 1024,
  pixels: 24_000_000,
  dimension: 10_000,
} as const;
export const imageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type ImageMime = (typeof imageMimeTypes)[number];

// Canonical UUIDs only: no paths, filenames, URL credentials, query or fragment.
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function mediaReference(id: string) {
  if (!uuid.test(id)) throw new Error("invalid_media_id");
  return `grove-media:${id}`;
}
export function mediaReferenceId(value: string): string | null {
  const id = value.startsWith("grove-media:") ? value.slice(12) : "";
  return uuid.test(id) ? id : null;
}

/** Immutable object identity; the last UUID identifies one write attempt. */
export function mediaObjectKey(
  accountId: string,
  mediaId: string,
  objectId: string,
) {
  if (![accountId, mediaId, objectId].every((id) => uuid.test(id)))
    throw new Error("invalid_media_key");
  return `media/${accountId}/${mediaId}/${objectId}`;
}
export function validateMediaKey(key: string): string {
  const [prefix, accountId, mediaId, objectId, extra] = key.split("/");
  if (
    prefix !== "media" ||
    extra !== undefined ||
    !accountId ||
    !mediaId ||
    !objectId ||
    mediaObjectKey(accountId, mediaId, objectId) !== key
  )
    throw new Error("invalid_media_key");
  return key;
}
