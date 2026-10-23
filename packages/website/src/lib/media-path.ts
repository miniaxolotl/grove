/** Resource identities come from validated API data, never storage keys/URLs. */
export function mediaPath(noteId: string, mediaId: string, version?: number) {
  return `/memories/${encodeURIComponent(noteId)}/media/${encodeURIComponent(mediaId)}${version ? `?version=${version}` : ""}`;
}
export function mediaSource(
  noteId: string,
  mediaId: string,
  version?: number,
  sharedRoot?: string,
) {
  return sharedRoot
    ? `${sharedRoot}/notes/${encodeURIComponent(noteId)}/media/${encodeURIComponent(mediaId)}`
    : `/api/grove${mediaPath(noteId, mediaId, version)}`;
}
