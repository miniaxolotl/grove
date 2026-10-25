/** Search evidence is query-scoped, never part of a canonical saved note. */
export type SearchText = { text: string; ranges: [number, number][] };
export type SearchMatch = {
  version: number;
  query: string;
  kind: "title" | "prefix" | "body" | "fuzzy" | "semantic";
  title: SearchText;
  snippet: SearchText;
};
export type SearchMatches = Record<string, SearchMatch>;

/** Match the SQL title resolver; do not split a surrogate pair at the limit. */
export function noteTitle(content: string, organized?: string) {
  const first = content.trim().split("\n")[0];
  const heading = first.match(/^#{1,6}\s+(.+)/)?.[1].trim();
  if (!heading && organized) return organized;
  const text = (heading || first).slice(0, 110);
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

export function plainExcerpt(content: string, length = 160) {
  const text = content
    .trim()
    .replace(/^#{1,6}[ \t]+[^\n]+\n+/, "")
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm, "")
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, "")
    .replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/gm, "")
    .replace(/!?\[([^\]\n]+)\]\([^\n)]*\)/g, "$1")
    .replace(/[#*`_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

/** Prefix/fuzzy expansion is additive; complex/oversized input stays strict. */
export function searchExpansion(query: string) {
  if (!/^[\p{L}\p{N}\s_]+$/u.test(query) || /\bor\b/i.test(query)) return;
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!tokens.length || tokens.length > 16 || tokens.some((t) => t.length > 64))
    return;
  return {
    tokens,
    prefix:
      tokens.at(-1)!.length >= 2
        ? tokens
            .map((t, i) => t + (i === tokens.length - 1 ? ":*" : ""))
            .join(" & ")
        : undefined,
  };
}
