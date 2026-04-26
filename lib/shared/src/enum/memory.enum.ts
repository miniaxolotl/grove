import { z } from "zod";

export const MemoryImportanceLevelSchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "forgettable",
]);

export const MemoryProjectStatusSchema = z.enum([
  "active",
  "archived",
  "deleted",
]);

export type MemoryImportanceLevel = z.infer<typeof MemoryImportanceLevelSchema>;
export type MemoryProjectStatus = z.infer<typeof MemoryProjectStatusSchema>;
