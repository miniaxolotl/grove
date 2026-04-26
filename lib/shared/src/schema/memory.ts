import { z } from "zod";

export const MemoryMetadataSchema = z.object({
  source: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  sessionId: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  lastAccessedAt: z.string().datetime().optional(),
});

export const MemorySchema = z.object({
  id: z.string(),
  text: z.string(),
  metadata: MemoryMetadataSchema.optional(),
});

export const MemorySearchResultSchema = z.object({
  id: z.string(),
  text: z.string(),
  metadata: MemoryMetadataSchema.optional(),
  score: z.number(),
});

export type MemoryMetadataInput = z.input<typeof MemoryMetadataSchema>;
export type MemoryMetadata = z.output<typeof MemoryMetadataSchema>;
export type MemoryInput = z.input<typeof MemorySchema>;
export type Memory = z.output<typeof MemorySchema>;
export type MemorySearchResultInput = z.input<typeof MemorySearchResultSchema>;
export type MemorySearchResult = z.output<typeof MemorySearchResultSchema>;
