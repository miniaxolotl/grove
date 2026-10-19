import { z } from "zod";

export const topics = [
  "architecture",
  "authentication",
  "database",
  "deployment",
  "testing",
  "frontend",
  "backend",
  "workflow",
  "preferences",
  "billing",
  "other",
] as const;
export const durableKindSchema = z.enum([
  "preference",
  "fact",
  "decision",
  "solution",
]);
export const relationshipSchema = z.enum([
  "duplicate",
  "complementary",
  "conflicting",
  "unrelated",
]);
export const sourceRefSchema = z
  .object({ id: z.uuid(), version: z.number().int().positive() })
  .strict();
export const annotationSchema = z
  .object({
    kind: durableKindSchema,
    topics: z.array(z.enum(topics)).max(5),
    salience: z.number().min(0).max(1),
    relationships: z
      .array(
        z.object({ id: z.uuid(), relationship: relationshipSchema }).strict(),
      )
      .max(5),
  })
  .strict();
export const organizationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    tags: z.array(z.string().trim().min(1).max(40)).max(6),
  })
  .strict();
export const briefContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(80),
            statements: z
              .array(
                z
                  .object({
                    text: z.string().trim().min(1).max(600),
                    sources: z.array(sourceRefSchema).min(1).max(8),
                  })
                  .strict(),
              )
              .max(6),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export const briefRequestSchema = z
  .object({
    projectId: z.uuid().nullable().default(null),
    taskId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type BriefRequest = z.infer<typeof briefRequestSchema>;
export type BriefContent = z.infer<typeof briefContentSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type ProcessingStatus = "disabled" | "pending" | "ready" | "failed";
export type Brief = {
  scope: BriefRequest;
  status: ProcessingStatus;
  content: BriefContent | null;
  profile: string | null;
  updatedAt: string | null;
  sourceCount: number;
  truncated: boolean;
};
export type Enrichment = {
  status: ProcessingStatus;
  title?: string;
  tags: string[];
  suggestedKind?: z.infer<typeof durableKindSchema>;
  salience?: number;
  relationships: {
    id: string;
    version: number;
    relationship: z.infer<typeof relationshipSchema>;
  }[];
  profiles: string[];
};

// URLs are installation-admin configuration, never memory content or agent arguments.
export const providerUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Use an HTTP(S) API base URL without credentials, query or fragment");
const endpoint = {
  baseUrl: providerUrlSchema,
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4096).default(""),
  timeoutMs: z.number().int().min(100).max(90000).default(30000),
};
export const embeddingConfigSchema = z
  .object({
    ...endpoint,
    provider: z.enum(["local", "openai-compatible", "disabled"]),
    dimensions: z.number().int().min(32).max(16000),
    queryPrefix: z.string().max(1000).default(""),
    documentPrefix: z.string().max(1000).default(""),
    distanceThreshold: z.number().min(0).max(2).default(0.65),
  })
  .strict();
export const decisionConfigSchema = z
  .object({
    ...endpoint,
    provider: z.enum(["system-one", "disabled"]),
    path: z.enum(["/decisions", "/systemone"]).default("/decisions"),
  })
  .strict();
export const generationConfigSchema = z
  .object({
    ...endpoint,
    provider: z.enum(["minimax", "openai-compatible", "disabled"]),
    outputFormat: z.enum(["tool", "json-schema", "json"]).default("tool"),
    reasoningEffort: z.enum(["low", "medium", "high", "omit"]).default("low"),
    maxOutputTokens: z.number().int().min(256).max(16384).default(4096),
  })
  .strict();
export const modelConfigSchema = z
  .object({
    embedding: embeddingConfigSchema,
    decision: decisionConfigSchema,
    generation: generationConfigSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.embedding.provider === "local" &&
      (value.embedding.dimensions !== 384 ||
        value.embedding.model !== "Xenova/all-MiniLM-L6-v2" ||
        value.embedding.queryPrefix ||
        value.embedding.documentPrefix)
    )
      ctx.addIssue({
        code: "custom",
        path: ["embedding"],
        message:
          "Local embeddings require the 384-dimensional MiniLM profile with empty prefixes",
      });
  });
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelRole = keyof ModelConfig;
export type ModelProfiles = Record<ModelRole, string | null>;
export type ModelSettings = {
  edition: "cloud" | "self-hosted";
  editable: boolean;
  version: number;
  config: ModelConfig;
  credentials: Record<ModelRole, boolean>;
  profiles: Record<ModelRole, string | null>;
};
export type Usage = { inputTokens: number; outputTokens: number };
export const modelUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    config: modelConfigSchema,
    clearKeys: z
      .array(z.enum(["embedding", "decision", "generation"]))
      .max(3)
      .default([]),
  })
  .strict();
