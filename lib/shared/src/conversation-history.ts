import { z } from "zod";
import type { ConversationSummary } from "@lib/shared/conversations";

export const conversationHistorySchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    after: z.string().max(2048).optional(),
  })
  .strict();
export type ConversationHistoryInput = z.infer<
  typeof conversationHistorySchema
>;
export const conversationHistoryCursorSchema = z.object({
  owner: z.uuid(),
  query: z.string(),
  id: z.uuid(),
  at: z.iso.datetime(),
});
export type ConversationHistoryCursor = z.infer<
  typeof conversationHistoryCursorSchema
>;
export type ConversationHistoryItem = ConversationSummary & {
  preview: string;
  turnCount: number;
};
export type ConversationHistoryPage = {
  items: ConversationHistoryItem[];
  nextCursor: string | null;
};
