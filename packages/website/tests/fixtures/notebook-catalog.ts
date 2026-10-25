import { createHash } from "node:crypto";

/** Adapt existing synthetic notebook fixtures to the new paged wire envelope.
 * Real paging/organization correctness is verified against the API separately. */
export function fixturePath(url: string) {
  return new URL(url).pathname.replace(/\/projects\/catalog$/, "/projects");
}
export function catalogResponse(url: string, data: unknown) {
  if (!new URL(url).pathname.endsWith("/projects/catalog")) return data;
  const items = (Array.isArray(data) ? data : [])
    .map((p) => ({ ...p }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    .map((p, i) => ({
      parentId: null,
      version: 1,
      status: "active",
      ...p,
      position: p.position ?? i + 1,
    }));
  return {
    items,
    state: createHash("sha256").update(JSON.stringify(items)).digest("hex"),
    nextCursor: null,
  };
}
