import {
  patchSchema,
  editScopeSchema,
  documentLimits,
  DocumentError,
  parseInput,
  type DocumentAnchor,
  type DocumentBlock,
} from "./schema.ts";
import {
  hashSource,
  snapshotHash,
  partition,
  validateDocument,
} from "./document.ts";
import { compareDocuments } from "./diff.ts";

function sameAnchor(a: DocumentAnchor, b: DocumentAnchor) {
  return a.afterId === b.afterId && a.beforeId === b.beforeId;
}
function anchorIndex(blocks: DocumentBlock[], anchor: DocumentAnchor): number {
  const index =
    anchor.afterId === null
      ? 0
      : blocks.findIndex((b) => b.id === anchor.afterId) + 1;
  if (
    (anchor.afterId !== null && index === 0) ||
    (blocks[index]?.id ?? null) !== anchor.beforeId
  ) {
    throw new DocumentError("target_conflict");
  }
  return index;
}
const boundary = (source: string, at: number) =>
  at >= 0 &&
  at <= source.length &&
  !(
    at > 0 &&
    at < source.length &&
    /[\uD800-\uDBFF]/.test(source[at - 1]) &&
    /[\uDC00-\uDFFF]/.test(source[at])
  );

/** Pure validation, not authorization or persisted idempotency. The service owns those. */
export async function applyDocumentPatch(
  documentInput: unknown,
  patchInput: unknown,
  scopeInput: unknown,
) {
  const document = await validateDocument(documentInput);
  const patch = parseInput(patchSchema, patchInput, "invalid_patch");
  const scope = parseInput(editScopeSchema, scopeInput, "invalid_patch");
  if (patch.noteId !== document.noteId)
    throw new DocumentError("document_mismatch");
  if (
    patch.baseRevision !== document.revision ||
    patch.baseHash !== document.hash
  )
    throw new DocumentError("version_conflict");
  if (document.revision === Number.MAX_SAFE_INTEGER)
    throw new DocumentError("invalid_patch");
  const blocks = structuredClone(document.blocks);
  const ranges = scope.ranges ?? [];
  for (const range of ranges) {
    const block = blocks.find((b) => b.id === range.nodeId);
    if (
      !block ||
      range.from > range.to ||
      !boundary(block.source, range.from) ||
      !boundary(block.source, range.to)
    ) {
      throw new DocumentError("invalid_patch");
    }
  }
  const used = new Set(blocks.map((b) => b.id));
  let inserted = 0;
  for (const [ordinal, op] of patch.operations.entries()) {
    inserted +=
      op.type === "insert_block"
        ? op.source.length
        : op.type === "replace_text"
          ? op.text.length
          : 0;
    if (inserted > documentLimits.insertedCharacters)
      throw new DocumentError("invalid_patch");
    if (op.type === "insert_block") {
      const index = anchorIndex(blocks, op.anchor);
      if (!scope.insertions.some((a) => sameAnchor(a, op.anchor)))
        throw new DocumentError("out_of_scope");
      // Operation-derived UUIDv8: stable on replay, allocated by the engine, never by a model.
      const digest = await hashSource(
        JSON.stringify([patch.noteId, patch.operationId, ordinal]),
      );
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      if (used.has(id)) throw new DocumentError("invalid_patch");
      used.add(id);
      blocks.splice(index, 0, {
        id,
        kind: "opaque",
        source: op.source,
        hash: await hashSource(op.source),
      });
    } else {
      const index = blocks.findIndex((b) => b.id === op.nodeId);
      if (index === -1 || blocks[index].hash !== op.expectedHash)
        throw new DocumentError("target_conflict");
      const block = blocks[index];
      const wholeBlock = scope.nodeIds.includes(op.nodeId);
      if (
        !wholeBlock &&
        (op.type !== "replace_text" ||
          !ranges.some(
            (r) => r.nodeId === op.nodeId && r.from <= op.from && r.to >= op.to,
          ))
      ) {
        throw new DocumentError("out_of_scope");
      }
      if (op.type === "delete_block") blocks.splice(index, 1);
      else if (op.type === "move_block") {
        blocks.splice(index, 1);
        const destination = anchorIndex(blocks, op.anchor);
        if (!scope.insertions.some((a) => sameAnchor(a, op.anchor)))
          throw new DocumentError("out_of_scope");
        blocks.splice(destination, 0, block);
      } else {
        if (
          op.from > op.to ||
          !boundary(block.source, op.from) ||
          !boundary(block.source, op.to)
        )
          throw new DocumentError("invalid_patch");
        if (block.source.slice(op.from, op.to) !== op.oldText)
          throw new DocumentError("target_conflict");
        const delta = op.text.length - (op.to - op.from);
        // Keep the independently supplied passage scope attached to its text.
        // Disjoint later passages shift, but unchanged gaps never become editable.
        if (!wholeBlock)
          for (const range of ranges) {
            if (range.nodeId !== op.nodeId) continue;
            if (range.from <= op.from && range.to >= op.to) range.to += delta;
            else if (range.from >= op.to) {
              range.from += delta;
              range.to += delta;
            } else if (range.to > op.from)
              throw new DocumentError("invalid_patch");
          }
        block.source =
          block.source.slice(0, op.from) + op.text + block.source.slice(op.to);
        block.hash = await hashSource(block.source);
      }
    }
    const source = blocks.map((b) => b.source).join("");
    if (
      !source.length ||
      source.length > documentLimits.characters ||
      blocks.length > documentLimits.blocks
    )
      throw new DocumentError("invalid_patch");
    const slices = partition(source);
    if (
      slices.length !== blocks.length ||
      slices.some((s, i) => s.source !== blocks[i].source)
    )
      throw new DocumentError("structure_conflict");
    slices.forEach((s, i) => {
      blocks[i].kind = s.kind;
    });
  }
  const hash = await snapshotHash(document.noteId, blocks);
  if (hash === document.hash) throw new DocumentError("no_change");
  const result = await validateDocument({
    ...document,
    revision: document.revision + 1,
    blocks,
    hash,
  });
  return { document: result, diff: await compareDocuments(document, result) };
}
