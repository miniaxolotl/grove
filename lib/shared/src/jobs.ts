import { z } from "zod";

export const queueLanes = [
  "indexing",
  "enrichment",
  "email",
  "maintenance",
  "bulk",
] as const;
export type QueueLane = (typeof queueLanes)[number];
export const taskKinds = [
  "export",
  "account_cleanup",
  "retention_cleanup",
  "artifact_cleanup",
  "model_backfill",
  "import",
  "connector_sync",
  "speech_transcribe",
  "speech_synthesize",
] as const;
export type TaskKind = (typeof taskKinds)[number];
export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface Task {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  processed: number;
  total: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  downloadable: boolean;
  scope?: { projectId: string | null; includeDescendants: boolean };
}
export const exportRequestSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid().optional(),
    includeDescendants: z.boolean().default(false),
    includeMedia: z.boolean().optional(),
  })
  .strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export const importRecordSchema = z
  .object({
    sourceId: z.string().min(1).max(200),
    content: z.string().min(1).max(6000),
    projectId: z.uuid().nullable().default(null),
  })
  .strict();
export const importRequestSchema = z
  .object({
    id: z.uuid(),
    source: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
    records: z.array(importRecordSchema).min(1).max(100),
  })
  .strict();
export type ImportRequest = z.infer<typeof importRequestSchema>;
