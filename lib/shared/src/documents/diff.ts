import {
  documentLimits,
  DocumentError,
  sourceSchema,
  parseInput,
  type DocumentTextDiff,
  type TextDiffPart,
  type DocumentDiff,
} from "./schema";
import { validateDocument } from "./document";

/** Deterministic LCS, used only after callers enforce an explicit cell budget. */
function commonIndices(a: string[], b: string[]): Set<number> {
  const width = b.length + 1;
  const cells = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      cells[i * width + j] =
        a[i] === b[j]
          ? cells[(i + 1) * width + j + 1] + 1
          : Math.max(cells[(i + 1) * width + j], cells[i * width + j + 1]);
    }
  }
  const result = new Set<number>();
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.add(i++);
      j++;
    } else if (cells[(i + 1) * width + j] >= cells[i * width + j + 1]) i++;
    else j++;
  }
  return result;
}

export function diffDocumentText(
  before: string,
  after: string,
): DocumentTextDiff {
  parseInput(sourceSchema, before, "invalid_document");
  parseInput(sourceSchema, after, "invalid_document");
  const a = before.match(/\s+|[^\s]+/gu) ?? [];
  const b = after.match(/\s+|[^\s]+/gu) ?? [];
  const parts: TextDiffPart[] = [];
  const add = (type: TextDiffPart["type"], text: string) => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.type === type) previous.text += text;
    else parts.push({ type, text });
  };
  if ((a.length + 1) * (b.length + 1) > documentLimits.diffCells) {
    // Linear fallback; code-point slices cannot split surrogate pairs.
    const x = Array.from(before),
      y = Array.from(after);
    let start = 0,
      end = 0;
    while (start < x.length && start < y.length && x[start] === y[start])
      start++;
    while (
      end < x.length - start &&
      end < y.length - start &&
      x[x.length - end - 1] === y[y.length - end - 1]
    )
      end++;
    add("equal", x.slice(0, start).join(""));
    add("delete", x.slice(start, x.length - end).join(""));
    add("insert", y.slice(start, y.length - end).join(""));
    add("equal", end ? x.slice(x.length - end).join("") : "");
    return { mode: "bounded", parts };
  }
  const common = commonIndices(a, b);
  let j = 0;
  a.forEach((token, i) => {
    if (!common.has(i)) add("delete", token);
    else {
      while (b[j] !== token) add("insert", b[j++]);
      add("equal", token);
      j++;
    }
  });
  while (j < b.length) add("insert", b[j++]);
  return { mode: "words", parts };
}

export async function compareDocuments(
  beforeInput: unknown,
  afterInput: unknown,
): Promise<DocumentDiff> {
  const before = await validateDocument(beforeInput);
  const after = await validateDocument(afterInput);
  if (before.noteId !== after.noteId)
    throw new DocumentError("document_mismatch");
  const old = new Map(before.blocks.map((b) => [b.id, b]));
  const current = new Map(after.blocks.map((b) => [b.id, b]));
  const beforeIndices = new Map(before.blocks.map((b, i) => [b.id, i]));
  const sharedBefore = before.blocks.filter((b) => current.has(b.id));
  const sharedAfter = after.blocks.filter((b) => old.has(b.id));
  const stable = commonIndices(
    sharedBefore.map((b) => b.id),
    sharedAfter.map((b) => b.id),
  );
  const unmoved = new Set([...stable].map((i) => sharedBefore[i].id));
  const changes: DocumentDiff["changes"] = [];
  for (const [beforeIndex, block] of before.blocks.entries()) {
    if (!current.has(block.id))
      changes.push({
        type: "delete",
        nodeId: block.id,
        before: block,
        beforeIndex,
      });
  }
  for (const [afterIndex, block] of after.blocks.entries()) {
    const previous = old.get(block.id);
    if (!previous)
      changes.push({
        type: "insert",
        nodeId: block.id,
        after: block,
        afterIndex,
      });
    else {
      if (!unmoved.has(block.id))
        changes.push({
          type: "move",
          nodeId: block.id,
          before: previous,
          after: block,
          beforeIndex: beforeIndices.get(block.id),
          afterIndex,
        });
      if (block.source !== previous.source || block.kind !== previous.kind)
        changes.push({
          type: "edit",
          nodeId: block.id,
          before: previous,
          after: block,
          beforeIndex: beforeIndices.get(block.id),
          afterIndex,
          text: diffDocumentText(previous.source, block.source),
        });
    }
  }
  return {
    noteId: before.noteId,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    beforeHash: before.hash,
    afterHash: after.hash,
    changes,
  };
}
