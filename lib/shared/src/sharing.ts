import { z } from "zod";
import { operationSchema, uuidSchema } from "./contracts.ts";

export const shareTokenSchema = z.string().regex(/^gsh_[A-Za-z0-9_-]{43}$/);
export const shareMutationSchema = z
  .object({
    operationId: operationSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const shareEnableSchema = shareMutationSchema.extend({
  expectedVersion: z.number().int().min(0),
  expectedTargetVersion: z.number().int().positive(),
  includeDescendants: z.boolean().default(false),
});
export const shareScopeSchema = shareMutationSchema.extend({
  includeDescendants: z.boolean(),
});
export const publicShareQuerySchema = z
  .object({
    cursor: z.string().max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export type ShareTarget = { kind: "note" | "notebook"; id: string };
export type ShareState = {
  available: boolean;
  canShare: boolean;
  target: ShareTarget & { name: string; version: number };
  direct: {
    id: string;
    version: number;
    active: boolean;
    includeDescendants: boolean;
    url: string | null;
  } | null;
  inherited: { id: string; projectId: string; name: string }[];
};
export type ShareEnable = z.infer<typeof shareEnableSchema>;
export type ShareMutation = z.infer<typeof shareMutationSchema>;

const notebook = z.object({ id: uuidSchema, name: z.string() }).strict();
export const publicNoteSchema = z
  .object({
    id: uuidSchema,
    title: z.string(),
    content: z.string(),
    updatedAt: z.string(),
    linkedNoteIds: z.array(uuidSchema),
  })
  .strict();
export const publicShareSchema = z
  .object({
    kind: z.enum(["note", "notebook"]),
    root: notebook,
    notebook: notebook.nullable(),
    note: publicNoteSchema.nullable(),
    notebooks: z.array(notebook),
    notes: z.array(
      publicNoteSchema.pick({ id: true, title: true, updatedAt: true }),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type PublicShare = z.infer<typeof publicShareSchema>;

/** Public titles are derived only from the text the owner chose to share. */
export function sharedNoteTitle(content: string): string {
  return (
    content
      .trim()
      .split("\n")[0]!
      .replace(/^#{1,6}\s+/, "")
      .slice(0, 110) || "Untitled note"
  );
}
