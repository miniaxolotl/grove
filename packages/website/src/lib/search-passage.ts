import { memoryExcerpt } from "./memory-display";

/** Literal, locale-independent case-insensitive tokens; never execute query regexes. */
export function queryWords(query: string) {
  return [
    ...new Set(
      query
        .slice(0, 500)
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ]
    .filter((word) => word.length > 1)
    .slice(0, 16);
}

export function searchPassage(content: string, query: string, length = 180) {
  const text = memoryExcerpt({ content: content.slice(0, 100_000) }, 100_000);
  const words = queryWords(query);
  // Regex matching preserves original UTF-16 offsets even for case-folding expansions.
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const matches = tokens.filter((token) =>
    words.includes(token[0].toLowerCase()),
  );
  const size = Math.max(40, Math.min(500, length));
  let start = 0;
  let best = 0;
  let left = 0;
  let right = 0;
  const counts = new Map<string, number>();
  for (const match of matches) {
    const candidate = Math.max(0, match.index - 40);
    while (
      right < matches.length &&
      matches[right].index + matches[right][0].length <= candidate + size
    ) {
      const word = matches[right++][0].toLowerCase();
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    while (left < right && matches[left].index < candidate) {
      const word = matches[left++][0].toLowerCase();
      const count = (counts.get(word) ?? 1) - 1;
      if (count) counts.set(word, count);
      else counts.delete(word);
    }
    if (counts.size > best) {
      best = counts.size;
      start = candidate;
    }
  }
  // Don't begin halfway through a word. Semantic-only hits use the ordinary opening.
  if (start) {
    const boundary = text.indexOf(" ", start);
    if (boundary >= 0 && boundary < start + 30) start = boundary + 1;
  }
  const end = Math.min(text.length, start + size);
  return `${start ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function passageParts(passage: string, query: string) {
  const words = queryWords(query);
  return passage.split(/([\p{L}\p{N}]+)/gu).map((text) => ({
    text,
    match: words.includes(text.toLowerCase()),
  }));
}
