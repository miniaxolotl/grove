/** Single source for content-size bounds shared by webapp, extension, API and worker. */
export const NOTE_CONTENT_MAX = 250_000;
/** Storage capacity is independent of automatic AI context and proofing budgets. */
export const RECALL_CONTENT_MAX = 6000;
export const PROOFING_CONTENT_MAX = 6000;
export const ASK_QUERY_MAX = 6000;
/** Fits two maximally JSON-escaped note bodies plus bounded write metadata. */
export const NOTE_REQUEST_BYTES_MAX = 4 * 1024 * 1024;
export const NOTE_TITLE_MAX = 110;
export const NOTE_EXCERPT_MAX = 160;
export const DOC_BYTES_MAX = 3 * 1024 * 1024;
export const WEB_URL_MAX = 4096;
export const SHARE_CURSOR_MAX = 2048;

/** Larger envelopes only for routes that can carry complete notes/source splices. */
export function requestBodyLimit(path: string) {
  const route = path.replace(/^\/?(?:v1\/)?/, "");
  return /^(?:mcp|memories(?:\/(?:[0-9a-f-]+(?:\/edit)?|daily\/[^/]+))?|browser\/captures|imports|import-batches\/[^/]+\/notes\/[^/]+|tools\/(?:remember|update_memory|preview_memory_patch|apply_memory_patch))$/.test(
    route,
  )
    ? NOTE_REQUEST_BYTES_MAX
    : 128 * 1024;
}
