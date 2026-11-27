import { z } from "zod";
import { uuidSchema } from "./contracts.ts";

export const organizeNoteSchema = z
  .object({
    operationId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    expectedState: z.string().regex(/^[a-f0-9]{64}$/),
    projectId: uuidSchema.nullable().optional(),
    beforeId: uuidSchema.optional(),
    afterId: uuidSchema.optional(),
  })
  .strict()
  .refine((input) => !(input.beforeId && input.afterId), {
    message: "Choose before or after, not both",
  });
export type OrganizeNote = z.infer<typeof organizeNoteSchema>;
export type NoteOrganization = {
  id: string;
  state: string;
  undo: { beforeId?: string; afterId?: string };
};
