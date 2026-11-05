import { createHash } from "node:crypto";
import { GroveError } from "@lib/shared/contracts";
import type { Knex } from "@lib/database";
import {
  createDocument,
  validateDocument,
  compareDocuments,
  type StructuredDocument,
} from "@lib/shared/documents";

/** Deterministic lazy legacy conversion; no writes, queued bulk work or history rewrite. */
export async function revisionDocument(
  trx: Knex.Transaction,
  noteId: string,
  version: number,
): Promise<StructuredDocument> {
  const row = await trx("memory_revisions")
    .where({ memoryId: noteId, version })
    .first("document", "content");
  if (!row) throw new GroveError("not_found", "Note revision unavailable", 404);
  if (row.document) {
    const doc = await validateDocument(row.document);
    if (
      doc.noteId !== noteId ||
      doc.revision !== version ||
      doc.blocks.map((b) => b.source).join("") !== row.content
    )
      throw new Error("Document projection mismatch");
    return doc;
  }
  const earlier = await trx("memory_revisions")
    .where({ memoryId: noteId })
    .where("version", "<", version)
    .whereNotNull("document")
    .orderBy("version", "desc")
    .first("document");
  return reconcileDocument(
    noteId,
    version,
    row.content,
    earlier ? await validateDocument(earlier.document) : undefined,
  );
}

export async function reconcileDocument(
  noteId: string,
  version: number,
  source: string,
  previous?: StructuredDocument,
): Promise<StructuredDocument> {
  const doc = await createDocument({ noteId, revision: version, source });
  const used = new Set<string>();
  const assign = (next: number, old: number) => {
    if (!used.has(previous!.blocks[old].id)) {
      doc.blocks[next].id = previous!.blocks[old].id;
      used.add(doc.blocks[next].id);
    }
  };
  let start = 0,
    end = 0;
  if (previous) {
    while (
      start < doc.blocks.length &&
      start < previous.blocks.length &&
      doc.blocks[start].source === previous.blocks[start].source
    ) {
      assign(start, start);
      start++;
    }
    while (
      end < doc.blocks.length - start &&
      end < previous.blocks.length - start &&
      doc.blocks[doc.blocks.length - end - 1].source ===
        previous.blocks[previous.blocks.length - end - 1].source
    ) {
      assign(doc.blocks.length - end - 1, previous.blocks.length - end - 1);
      end++;
    }
    for (let i = start; i < doc.blocks.length - end; i++) {
      const matches = previous.blocks
        .map((b, j) => ({ b, j }))
        .filter(
          ({ b }) => b.source === doc.blocks[i].source && !used.has(b.id),
        );
      if (
        matches.length === 1 &&
        doc.blocks.filter((b) => b.source === doc.blocks[i].source).length === 1
      )
        assign(i, matches[0].j);
    }
    const old = previous.blocks.filter((b) => !used.has(b.id));
    const next = doc.blocks.filter((b) => !used.has(b.id));
    if (old.length === 1 && next.length) {
      next[0].id = old[0].id;
      used.add(old[0].id);
    }
  }
  for (const [i, block] of doc.blocks.entries()) {
    if (used.has(block.id)) continue;
    const h = createHash("sha256")
      .update(JSON.stringify([noteId, version, i, block.source]))
      .digest("hex");
    block.id = `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  // The public core validates the exact same hash layout at its boundary.
  doc.hash = createHash("sha256")
    .update(
      JSON.stringify([
        1,
        noteId,
        doc.blocks.map((b) => [b.id, b.kind, b.source]),
      ]),
    )
    .digest("hex");
  return validateDocument(doc);
}

export async function documentRevisionValues(
  trx: Knex.Transaction,
  row: { id: string; version: number; content: string },
) {
  const previousRow =
    row.version > 1
      ? await trx("memory_revisions")
          .where({ memoryId: row.id, version: row.version - 1 })
          .first("version")
      : undefined;
  const previous = previousRow
    ? await revisionDocument(trx, row.id, row.version - 1)
    : undefined;
  const document = await reconcileDocument(
    row.id,
    row.version,
    row.content,
    previous,
  );
  return {
    document: JSON.stringify(document),
    change: previous
      ? JSON.stringify(await compareDocuments(previous, document))
      : null,
  };
}
