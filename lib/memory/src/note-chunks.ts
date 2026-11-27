import { createHash } from "node:crypto";

export const noteChunkVersion = "paragraph-v1";
export const noteChunkCharacters = 2000;
const hashText = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export type NoteChunk = {
  from: number;
  to: number;
  text: string;
  hash: string;
};

/** Bounded lexical fallback for explicit sources without a query vector. */
export function selectNotePassage(source: string, query: string): NoteChunk {
  const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const chunks = chunkNote(source);
  return chunks.reduce((best, chunk) => {
    const score = (text: string) => {
      const words = new Set(
        text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
      );
      return [...terms].filter((term) => words.has(term)).length;
    };
    return score(chunk.text) > score(best.text) ? chunk : best;
  }, chunks[0]);
}

/** Paragraph-local boundaries keep edits from shifting the rest of a document.
 * Small adjacent blocks are grouped; long paragraphs prefer sentences/whitespace.
 * Source ranges are exact UTF-16 offsets, never normalized or surrogate-split. */
export function chunkNote(source: string): NoteChunk[] {
  const chunks: NoteChunk[] = [];
  const emit = (from: number, to: number) => {
    const text = source.slice(from, to);
    chunks.push({ from, to, text, hash: hashText(text) });
  };
  const split = (from: number, to: number) => {
    while (to - from > noteChunkCharacters) {
      let end = from + noteChunkCharacters;
      const window = source.slice(from + 1000, end);
      const boundaries = [...window.matchAll(/[.!?][ \t]+|\s+/gu)];
      const boundary = boundaries.at(-1);
      if (boundary) end = from + 1000 + boundary.index! + boundary[0].length;
      if (
        /[\uD800-\uDBFF]/.test(source[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(source[end])
      )
        end--;
      emit(from, end);
      from = end;
    }
    if (to > from) emit(from, to);
  };
  let from = 0;
  for (const match of source.matchAll(/\r?\n[ \t]*\r?\n+/g)) {
    const end = match.index + match[0].length;
    if (end - from >= 512) {
      split(from, end);
      from = end;
    }
  }
  split(from, source.length);
  return chunks;
}

/** Anchor unchanged chunks from both ends, even when an insertion shifts every
 * offset in a paragraph. Hash the current text before trusting a saved boundary. */
export function revisedChunks(
  source: string,
  previous: { sourceFrom: number; sourceTo: number; contentHash: string }[],
) {
  let from = 0,
    to = source.length,
    i = 0,
    j = previous.length;
  const prefix: NoteChunk[] = [],
    suffix: NoteChunk[] = [];
  const match = (index: number, start: number, end: number) => {
    if (start < from || end > to) return;
    const text = source.slice(start, end),
      hash = previous[index].contentHash;
    if (hashText(text) === hash) return { from: start, to: end, text, hash };
  };
  while (i < j) {
    const chunk = match(
      i,
      from,
      from + previous[i].sourceTo - previous[i].sourceFrom,
    );
    if (!chunk) break;
    prefix.push(chunk);
    from = chunk.to;
    i++;
  }
  while (i < j) {
    const chunk = match(
      j - 1,
      to - (previous[j - 1].sourceTo - previous[j - 1].sourceFrom),
      to,
    );
    if (!chunk) break;
    suffix.push(chunk);
    to = chunk.from;
    j--;
  }
  // Fold a small neighboring fragment into the changed span rather than
  // accumulating a separate stored vector for every appended keystroke.
  if (to > from && prefix.at(-1) && prefix.at(-1)!.text.length < 512)
    from = prefix.pop()!.from;
  if (to > from && suffix.at(-1) && suffix.at(-1)!.text.length < 512)
    to = suffix.pop()!.to;
  return [
    ...prefix,
    ...chunkNote(source.slice(from, to)).map((c) => ({
      ...c,
      from: from + c.from,
      to: from + c.to,
    })),
    ...suffix.reverse(),
  ];
}
