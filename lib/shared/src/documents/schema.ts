import { z } from "zod";

export const documentLimits = {
  characters: 6000,
  blocks: 256,
  operations: 50,
  insertedCharacters: 6000,
  diffCells: 262144,
} as const;

export class DocumentError extends Error {
  constructor(
    public readonly code:
      | "invalid_document"
      | "invalid_patch"
      | "document_mismatch"
      | "version_conflict"
      | "target_conflict"
      | "out_of_scope"
      | "structure_conflict"
      | "no_change",
  ) {
    super(`Document operation rejected: ${code}`);
    this.name = "DocumentError";
  }
}

export const sourceSchema = z
  .string()
  .max(documentLimits.characters)
  .refine(
    (text) => !/[\uD800-\uDFFF]/u.test(text),
    "Source must contain well-formed Unicode",
  );
const id = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const blockSchema = z
  .object({
    id,
    kind: z.enum([
      "heading",
      "paragraph",
      "list",
      "quote",
      "code",
      "table",
      "definition",
      "thematic_break",
      "opaque",
    ]),
    source: sourceSchema.refine((s) => s.length > 0),
    hash,
  })
  .strict();
export type DocumentBlock = z.infer<typeof blockSchema>;
export const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    noteId: id,
    revision,
    hash,
    blocks: z.array(blockSchema).min(1).max(documentLimits.blocks),
  })
  .strict();
export type StructuredDocument = z.infer<typeof documentSchema>;
export const createDocumentSchema = z
  .object({
    noteId: id,
    revision,
    source: sourceSchema.refine((s) => s.length > 0),
  })
  .strict();

export const anchorSchema = z
  .object({ afterId: id.nullable(), beforeId: id.nullable() })
  .strict();
export type DocumentAnchor = z.infer<typeof anchorSchema>;
const target = { nodeId: id, expectedHash: hash };
export const operationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace_text"),
      ...target,
      from: z.number().int().min(0).max(documentLimits.characters),
      to: z.number().int().min(0).max(documentLimits.characters),
      oldText: sourceSchema,
      text: sourceSchema,
    })
    .strict(),
  z.object({ type: z.literal("delete_block"), ...target }).strict(),
  z
    .object({ type: z.literal("move_block"), ...target, anchor: anchorSchema })
    .strict(),
  z
    .object({
      type: z.literal("insert_block"),
      source: sourceSchema.refine((s) => s.length > 0),
      anchor: anchorSchema,
    })
    .strict(),
]);
export type DocumentOperation = z.infer<typeof operationSchema>;
export const patchSchema = z
  .object({
    noteId: id,
    baseRevision: revision,
    baseHash: hash,
    operationId: id,
    operations: z.array(operationSchema).min(1).max(documentLimits.operations),
  })
  .strict();
export type DocumentPatch = z.infer<typeof patchSchema>;
export const editScopeSchema = z
  .object({
    nodeIds: z.array(id).max(documentLimits.blocks),
    insertions: z.array(anchorSchema).max(documentLimits.blocks + 1),
    ranges: z
      .array(
        z
          .object({
            nodeId: id,
            from: z.number().int().min(0).max(documentLimits.characters),
            to: z.number().int().min(0).max(documentLimits.characters),
          })
          .strict(),
      )
      .max(documentLimits.blocks)
      .optional(),
  })
  .strict();
export type DocumentEditScope = z.infer<typeof editScopeSchema>;

export type TextDiffPart = {
  type: "equal" | "insert" | "delete";
  text: string;
};
export type DocumentTextDiff = {
  mode: "words" | "bounded";
  parts: TextDiffPart[];
};
export type DocumentChange = {
  type: "insert" | "delete" | "move" | "edit";
  nodeId: string;
  before?: DocumentBlock;
  after?: DocumentBlock;
  beforeIndex?: number;
  afterIndex?: number;
  text?: DocumentTextDiff;
};
export type DocumentDiff = {
  noteId: string;
  beforeRevision: number;
  afterRevision: number;
  beforeHash: string;
  afterHash: string;
  changes: DocumentChange[];
};

export function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: "invalid_document" | "invalid_patch",
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DocumentError(code);
  return result.data;
}
