import { z } from "zod";
import {
  answerSchema,
  sourceRefSchema,
  type SourceRef,
} from "@lib/shared/models";
import type { Memory } from "./contracts.ts";

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
    intent: z.enum(["answer", "find", "edit", "merge", "create"]),
    references: z.array(z.uuid()).max(8),
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
  })
  .strict();
// Tool providers can encode nullable objects as {}, losing the distinction between
// no action and an incomplete action. Empty arrays represent absence on the wire;
// the public conversation contract still exposes a single proposal or null.
export const conversationGenerationSchema = conversationReplySchema
  .omit({ proposal: true })
  .extend({
    proposals: z
      .array(
        noteProposalSchema.extend({
          target: z.array(sourceRefSchema).max(1),
        }),
      )
      .max(1),
  });
export type ConversationScope = z.infer<typeof conversationScopeSchema>;
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
};
export type ConversationSummary = {
  id: string;
  title: string;
  scope: ConversationScope;
  version: number;
  updatedAt: string;
};
export type Conversation = ConversationSummary & { turns: ConversationTurn[] };
export type ConversationPage = {
  items: ConversationSummary[];
  nextCursor: string | null;
};
