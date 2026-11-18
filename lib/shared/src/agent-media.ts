import { z } from "zod";
import { expectedVersionSchema, uuidSchema } from "./contracts.ts";

/** Structured agent discovery for note images/recordings. Metadata only. */
export const listNoteMediaSchema = z
  .object({
    memoryId: uuidSchema.describe("Exact note ID to inventory."),
    version: expectedVersionSchema
      .optional()
      .describe(
        "Exact bound revision; omit for the current revision. History renders while the note stays accessible.",
      ),
  })
  .strict();

export const describeNoteMediaSchema = z
  .object({
    memoryId: uuidSchema.describe("Exact note ID holding the attachment."),
    mediaId: uuidSchema.describe("Opaque attachment UUID from list output."),
    version: expectedVersionSchema
      .optional()
      .describe("Exact bound revision; omit for the current revision."),
  })
  .strict();

export const readMediaTranscriptSchema = describeNoteMediaSchema;

export type ListNoteMedia = z.infer<typeof listNoteMediaSchema>;
export type DescribeNoteMedia = z.infer<typeof describeNoteMediaSchema>;
export type ReadMediaTranscript = z.infer<typeof readMediaTranscriptSchema>;

/** Safe descriptor returned to agents. No object keys, hashes, or bytes. */
export type AgentMediaDescriptor = {
  id: string;
  reference: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number | null;
  version: number;
  transcriptVersion: number;
  hasTranscript: boolean;
};
