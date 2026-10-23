import { z } from "zod";
import {
  answerSchema,
  sourceRefSchema,
  type SourceRef,
} from "@lib/shared/models";
import type { Memory } from "./contracts.ts";

export const askToolsSchema = z
  .object({ exa: z.boolean(), tavily: z.boolean(), organize: z.boolean() })
  .strict();
export type AskTools = z.infer<typeof askToolsSchema>;
export const defaultAskTools: AskTools = {
  exa: true,
  tavily: false,
  organize: true,
};
export const toolSettingsSchema = z
  .object({
    tools: askToolsSchema,
    expectedVersion: z.number().int().nonnegative(),
    saveDefault: z.boolean().optional(),
  })
  .strict();
export type ToolSettings = z.infer<typeof toolSettingsSchema>;
export const researchRequestSchema = z
  .object({
    provider: z.enum(["exa", "tavily"]),
    query: z.string().max(500),
    urls: z.array(z.string().max(2000)).max(3),
  })
  .strict();
export type ResearchRequest = z.infer<typeof researchRequestSchema>;
export type WebSource = {
  id: string;
  url: string;
  title: string;
  text: string;
  provider: "exa" | "tavily";
  retrievedAt: string;
  kind: "search" | "page";
};
export type ToolRun = {
  key: string;
  provider: "exa" | "tavily";
  operation: "search" | "extract";
  status: "running" | "complete" | "failed" | "limited";
  sources: WebSource[];
};
const webStatementSchema = z
  .object({
    text: z.string().trim().min(1).max(1200),
    urls: z.array(z.string().max(2000)).min(1).max(5),
  })
  .strict();
const destinationSchema = z
  .union([z.uuid(), z.string().regex(/^new:[a-z0-9_-]{1,40}$/)])
  .nullable();
export const organizationProposalSchema = z
  .object({
    notebooks: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
            name: z.string().trim().min(1).max(120),
            parent: destinationSchema.default(null),
          })
          .strict(),
      )
      .max(6)
      .default([]),
    renames: z
      .array(
        sourceRefSchema.extend({ name: z.string().trim().min(1).max(120) }),
      )
      .max(6)
      .default([]),
    moves: z
      .array(sourceRefSchema.extend({ destination: destinationSchema }))
      .max(30)
      .default([]),
    notes: z
      .array(
        z
          .object({
            content: z.string().trim().min(1).max(6000),
            destination: destinationSchema,
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();
export type OrganizationChanges = z.infer<typeof organizationProposalSchema>;
export type OrganizationProposal = OrganizationChanges & {
  status: "proposed" | "applied" | "undone" | "unavailable";
  notebookRefs: (SourceRef & { name: string })[];
  applied?: SourceRef[];
  createdNotebooks?: string[];
  coverage: { shown: number; total: number; nextCursor: string | null };
};

export const conversationScopeSchema = z
  .object({
    projectId: z.uuid().nullable().optional(),
    includePersonal: z.boolean().default(false),
  })
  .strict();
export const conversationCreateSchema = conversationScopeSchema.extend({
  id: z.uuid(),
});
export const conversationTurnSchema = z
  .object({
    id: z.uuid(),
    query: z.string().trim().min(1).max(6000),
    format: z.enum(["plain", "markdown"]).default("plain"),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export const conversationPlanSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    intent: z.enum(["answer", "find", "edit", "merge", "create", "organize"]),
    references: z.array(z.uuid()).max(8),
    research: z.array(researchRequestSchema).max(2).default([]),
    organizeAfter: z.uuid().nullable().default(null),
  })
  .strict();
export const noteProposalSchema = z
  .object({
    kind: z.enum(["edit", "merge", "create"]),
    target: sourceRefSchema.nullable(),
    sources: z.array(sourceRefSchema).max(6),
    content: z.string().trim().min(1).max(6000),
  })
  .strict();
export const conversationReplySchema = z
  .object({
    message: z.string().trim().max(2000),
    statements: answerSchema.shape.statements,
    proposal: noteProposalSchema.nullable(),
    webStatements: z.array(webStatementSchema).max(8).default([]),
  })
  .strict();
// Tool providers can encode nullable objects as {}, losing the distinction between
// no action and an incomplete action. Empty arrays represent absence on the wire;
// the public conversation contract still exposes a single proposal or null.
export const conversationGenerationSchema = conversationReplySchema
  .omit({ proposal: true })
  .extend({
    organization: z.array(organizationProposalSchema).max(1).default([]),
    proposals: z
      .array(
        noteProposalSchema.extend({
          target: z.array(sourceRefSchema).max(1),
        }),
      )
      .max(1),
  });
export type ConversationScope = z.infer<typeof conversationScopeSchema>;
/** Expose only the action/evidence shapes that this turn can actually authorize.
 * Empty tuples avoid providers inventing records merely to fill an object schema. */
export function conversationResponseSchema(
  intent: string,
  notes: boolean,
  web: boolean,
  writes: boolean,
) {
  const proposal = conversationGenerationSchema.shape.proposals.element;
  return conversationGenerationSchema.extend({
    statements: notes ? conversationReplySchema.shape.statements : z.tuple([]),
    webStatements: web
      ? conversationReplySchema.shape.webStatements
      : z.tuple([]).default([]),
    organization:
      writes && intent === "organize"
        ? conversationGenerationSchema.shape.organization
        : z.tuple([]).default([]),
    proposals: !writes
      ? z.tuple([]).default([])
      : intent === "create"
        ? z
            .array(
              proposal.extend({
                kind: z.literal("create"),
                target: z.tuple([]),
                sources: z.tuple([]),
              }),
            )
            .max(1)
        : notes && (intent === "edit" || intent === "merge")
          ? z.array(proposal.extend({ kind: z.literal(intent) })).max(1)
          : z.tuple([]).default([]),
  });
}
export type ConversationCreate = z.infer<typeof conversationCreateSchema>;
export type ConversationTurnRequest = z.infer<typeof conversationTurnSchema>;
export type NoteProposal = z.infer<typeof noteProposalSchema> & {
  status: "proposed" | "applied" | "undone" | "unavailable";
  applied?: SourceRef[];
};
export type ConversationReply = Omit<
  z.infer<typeof conversationReplySchema>,
  "proposal"
> & {
  sources: Memory[];
  proposal: NoteProposal | null;
  webSources?: WebSource[];
  researchIncomplete?: boolean;
  organization?: OrganizationProposal;
};
export type ConversationTurn = {
  id: string;
  question: string;
  format: "plain" | "markdown";
  expectedVersion: number;
  status: "pending" | "ready" | "failed";
  result: ConversationReply | null;
  error: string | null;
  createdAt: string;
  toolRuns?: ToolRun[];
};
export type ConversationSummary = {
  id: string;
  title: string;
  scope: ConversationScope;
  version: number;
  updatedAt: string;
  tools: AskTools;
  toolsVersion: number;
};
export type Conversation = ConversationSummary & { turns: ConversationTurn[] };
export type ConversationPage = {
  items: ConversationSummary[];
  nextCursor: string | null;
};
