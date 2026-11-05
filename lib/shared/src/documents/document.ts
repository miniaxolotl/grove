import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import {
  createDocumentSchema,
  documentSchema,
  documentLimits,
  DocumentError,
  parseInput,
  type DocumentBlock,
  type StructuredDocument,
} from "./schema";

export async function hashSource(source: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

type Slice = Pick<DocumentBlock, "kind" | "source">;
/** Top-level blocks own their trailing separators; a leading gap owns itself. */
export function partition(source: string): Slice[] {
  const nodes = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }).children;
  const kinds: Record<string, DocumentBlock["kind"]> = {
    heading: "heading",
    paragraph: "paragraph",
    list: "list",
    blockquote: "quote",
    code: "code",
    table: "table",
    definition: "definition",
    thematicBreak: "thematic_break",
  };
  const slices: Slice[] = [];
  const start = nodes[0]?.position?.start.offset ?? source.length;
  if (start) slices.push({ kind: "opaque", source: source.slice(0, start) });
  nodes.forEach((node, i) => {
    const from = node.position!.start.offset!;
    const to = nodes[i + 1]?.position?.start.offset ?? source.length;
    slices.push({
      kind: kinds[node.type] ?? "opaque",
      source: source.slice(from, to),
    });
  });
  // Preserve dense/unsupported documents without claiming fine-grained targets.
  return slices.length > documentLimits.blocks
    ? [{ kind: "opaque", source }]
    : slices;
}

export function snapshotHash(noteId: string, blocks: DocumentBlock[]) {
  return hashSource(
    JSON.stringify([1, noteId, blocks.map((b) => [b.id, b.kind, b.source])]),
  );
}

export async function createDocument(input: {
  noteId: string;
  revision: number;
  source: string;
}): Promise<StructuredDocument> {
  const { noteId, revision, source } = parseInput(
    createDocumentSchema,
    input,
    "invalid_document",
  );
  const blocks = await Promise.all(
    partition(source).map(async (b) => ({
      ...b,
      id: globalThis.crypto.randomUUID(),
      hash: await hashSource(b.source),
    })),
  );
  return {
    schemaVersion: 1,
    noteId,
    revision,
    blocks,
    hash: await snapshotHash(noteId, blocks),
  };
}

/** Serialization is not authentication/validation; use validateDocument on external snapshots. */
export function serializeDocument(document: StructuredDocument): string {
  return document.blocks.map((b) => b.source).join("");
}

export async function validateDocument(
  input: unknown,
): Promise<StructuredDocument> {
  const document = parseInput(documentSchema, input, "invalid_document");
  const source = serializeDocument(document);
  const slices =
    source.length <= documentLimits.characters ? partition(source) : [];
  if (
    slices.length !== document.blocks.length ||
    new Set(document.blocks.map((b) => b.id)).size !== document.blocks.length ||
    slices.some(
      (s, i) =>
        s.kind !== document.blocks[i].kind ||
        s.source !== document.blocks[i].source,
    ) ||
    (await snapshotHash(document.noteId, document.blocks)) !== document.hash ||
    (
      await Promise.all(
        document.blocks.map(
          async (b) => (await hashSource(b.source)) === b.hash,
        ),
      )
    ).some((valid) => !valid)
  )
    throw new DocumentError("invalid_document");
  return document;
}
