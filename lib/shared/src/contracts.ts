import { z } from "zod";
import type { Brief, Enrichment } from "./models.ts";

export const capabilities = [
  "memory:read",
  "memory:write",
  "memory:delete",
] as const;
export const capabilitySchema = z.enum(capabilities);
export type Capability = z.infer<typeof capabilitySchema>;
// Clerk accepts OIDC identity scopes; Grove's database grant owns memory authorization.
export const oauthScopes = ["openid", "offline_access"] as const;
export const uuidSchema = z.uuid();
export const operationSchema = z.uuid();
export const kindSchema = z.enum([
  "preference",
  "fact",
  "decision",
  "solution",
  "handoff",
]);
export const sourceSchema = z
  .object({
    agent: z
      .enum(["website", "opencode", "claude", "codex", "cli", "import", "api"])
      .default("api"),
    session: z.string().max(128).optional(),
    verification: z.string().max(500).optional(),
  })
  .strict();
export const rememberSchema = z
  .object({
    operationId: operationSchema,
    id: uuidSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    content: z.string().trim().min(1).max(6000),
    capture: z.enum(["explicit", "automatic"]).default("explicit"),
    archived: z.boolean().default(false),
    kind: kindSchema.default("fact"),
    autoKind: z.boolean().default(false),
    projectId: uuidSchema.nullable().default(null),
    taskId: z.string().min(1).max(128).optional(),
    source: sourceSchema.default({ agent: "api" }),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.autoKind && input.kind === "handoff")
      ctx.addIssue({ code: "custom", message: "Handoff kind is explicit" });
    if (Boolean(input.id) !== Boolean(input.expectedVersion)) {
      ctx.addIssue({
        code: "custom",
        message: "Corrections require both id and expectedVersion",
      });
    }
    if (input.id && input.archived)
      ctx.addIssue({
        code: "custom",
        message: "Use the archive action for existing memories",
      });
    if ((input.kind === "handoff") !== Boolean(input.taskId)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Handoffs require a stable taskId; durable memories cannot have one",
      });
    }
  });
export const listSchema = z
  .object({
    projectId: uuidSchema.nullable().optional(),
    kind: kindSchema.optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    status: z.enum(["active", "archived", "expired", "all"]).default("active"),
    query: z.string().trim().max(1000).optional(),
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export const recallSchema = z
  .object({
    query: z.string().trim().max(1000).default(""),
    projectId: uuidSchema.nullable().default(null),
    includePersonal: z.boolean().default(true),
    taskId: z.string().max(128).optional(),
    limit: z.number().int().min(1).max(12).default(8),
    maxCharacters: z.number().int().min(256).max(6000).default(6000),
  })
  .strict();
export const versionSchema = z
  .object({
    operationId: operationSchema,
    expectedVersion: z.number().int().positive(),
    revision: z.number().int().positive().optional(),
    durable: z.boolean().optional(),
  })
  .strict();
export const forgetSchema = z
  .object({
    operationId: operationSchema,
    items: z
      .array(
        z
          .object({
            id: uuidSchema,
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    identity: z.string().trim().min(1).max(500),
  })
  .strict();
export const grantSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    capabilities: z.array(capabilitySchema).min(1).max(3),
    personal: z.boolean().default(true),
    allProjects: z.boolean().default(false),
    projectIds: z.array(uuidSchema).max(100).default([]),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();
export const connectionSchema = grantSchema.extend({
  clientId: z.string().min(1).max(500),
});
export const agentSchema = z.enum(["opencode", "claude", "codex"]);
export const agentNames = {
  opencode: "OpenCode",
  claude: "Claude Code",
  codex: "Codex",
} as const;
export const connectSchema = z
  .object({
    agent: agentSchema,
    project: projectSchema.nullable(),
  })
  .strict();
export const approveConnectSchema = grantSchema.extend({
  currentProject: z.boolean().default(true),
});
export type ConnectInput = z.infer<typeof connectSchema>;
export type ConnectApproval = z.infer<typeof approveConnectSchema>;
export type ConnectAttempt = ConnectInput & {
  id: string;
  connectionId: string;
  clientId: string | null;
  status: "pending" | "approved" | "cancelled" | "expired";
  expiresAt: string;
  projectId: string | null;
  grant: Grant;
};
export type ConnectResponse = ConnectAttempt & { approvalUrl: string };
export const memorySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  content: z.string(),
  kind: kindSchema,
  autoKind: z.boolean().optional(),
  status: z.enum(["active", "archived"]),
  version: z.number().int(),
  source: sourceSchema,
  taskId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  purgeAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  indexing: z.enum(["disabled", "pending", "ready", "failed"]),
  enrichment: z.custom<Enrichment>().optional(),
});
export type Memory = z.infer<typeof memorySchema>;
export type Remember = z.infer<typeof rememberSchema>;
export type MemoryList = z.infer<typeof listSchema>;
export type Recall = z.infer<typeof recallSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type Principal = {
  accountId: string;
  subject: string;
  type: "session" | "oauth" | "key";
  connectionId?: string;
  sessionId?: string;
  clientId?: string;
  issuedAt?: number;
  capabilities: Capability[];
};
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  searchMode?: "hybrid" | "lexical";
};
export type RecallResult = {
  items: Memory[];
  mode: "hybrid" | "lexical" | "profile";
  contentVersion: number;
  briefs?: Brief[];
};
export type ApiEnvelope<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; requestId?: string };
    };

export class GroveError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "GroveError";
  }
}
