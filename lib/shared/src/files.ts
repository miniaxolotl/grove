import { z } from "zod";

export const fileSourceSchema = z.enum(["chat", "import", "media"]);
export const fileCursorSchema = z
  .object({ owner: z.uuid(), binding: z.string(), key: z.string().max(100) })
  .strict();
export const fileSearchSchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    kind: z.enum(["document", "image", "recording"]).optional(),
    memoryId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
    after: z.string().max(2048).optional(),
  })
  .strict();
export const fileLocationsSchema = z
  .object({
    source: fileSourceSchema,
    id: z.uuid(),
    after: z.string().max(2048).optional(),
  })
  .strict();
export type FileSearch = z.infer<typeof fileSearchSchema>;
export type UploadedFile = {
  id: string;
  source: z.infer<typeof fileSourceSchema>;
  kind: "document" | "image" | "recording";
  filename: string;
  bytes: number;
  status: "pending" | "ready" | "failed";
  state: "staged" | "retained" | "reserved";
  createdAt: string;
  expiresAt: string | null;
  locationCount: number;
};
export type FilePage = { items: UploadedFile[]; nextCursor: string | null };
export type FileLocation = {
  key: string;
  title: string;
  memoryId: string | null;
  projectId: string | null;
  projectName: string | null;
  conversationId: string | null;
  batchId: string | null;
  archived: boolean;
  historical: boolean;
  downloadPath: string | null;
};
export type FileLocations = {
  items: FileLocation[];
  nextCursor: string | null;
};
export type FileStorage = {
  budgetBytes: number;
  byteLimit: number;
  attempts: number;
  attemptLimit: number;
  stagingBytes: number;
  stagingLimit: number;
  visibleBytes: number;
  fileCount: number;
};
