import { z } from "zod";
import type { LinkPreviewRequest } from "./internal-links.ts";

const revision = z.union([
  z.number().int().positive().max(2147483647),
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().max(2147483647)),
]);

/** Server validation stays separate from lightweight browser URL recognition. */
export const linkPreviewRequestSchema = z
  .object({
    kind: z.enum(["note", "notebook"]),
    id: z.uuid(),
    revision: revision.optional(),
  })
  .strict()
  .refine((input) => input.kind === "note" || input.revision === undefined, {
    message: "Notebook links do not support note revisions",
  }) satisfies z.ZodType<LinkPreviewRequest>;
