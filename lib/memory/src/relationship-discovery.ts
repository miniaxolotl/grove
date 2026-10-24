/** Bounded, whole-document lexical hints. Never used as relationship evidence. */
export function relationshipTerms(content: string, limit = 64): string[] {
  const stop = new Set(
    "the and for are was were with from this that have has had will your they their been into about when then there not but you our its can all how what which who also than these those".split(
      " ",
    ),
  );
  const tokens = [
    ...new Set(
      (content.match(/[\p{L}\p{N}]{2,}/gu) ?? [])
        .map((s) => s.toLowerCase())
        .filter((s) => !stop.has(s) && /\p{L}/u.test(s)),
    ),
  ];
  if (tokens.length <= limit) return tokens;
  // Stratified selection retains both ends and avoids spending all hints on a header.
  return Array.from(
    { length: limit },
    (_, i) => tokens[Math.round((i * (tokens.length - 1)) / (limit - 1))],
  );
}

export function lexicalCandidates<T extends { id: string; content: string }>(
  content: string,
  pool: T[],
  limit: number,
): T[] {
  const terms = new Set(relationshipTerms(content));
  const tokens = pool.map((row) => new Set(relationshipTerms(row.content)));
  const frequency = new Map<string, number>();
  for (const set of tokens)
    for (const word of set) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  return pool
    .map((row, i) => ({
      row,
      score: [...tokens[i]].reduce(
        (sum, word) =>
          sum +
          (terms.has(word)
            ? Math.log(1 + pool.length / (frequency.get(word) ?? 1))
            : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit)
    .map(({ row }) => row);
}
