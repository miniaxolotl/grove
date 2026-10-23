import type { ConversationScope } from "@lib/shared/conversations";

/** Notebook hierarchy is navigation; it never implicitly expands chat scope. */
export const inConversationScope = (
  scope: ConversationScope,
  projectId: string | null,
) =>
  scope.projectId === undefined ||
  projectId === scope.projectId ||
  (scope.includePersonal && projectId === null);
