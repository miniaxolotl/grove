import type { Memory } from "@lib/shared/contracts";
import { noteTitle, plainExcerpt } from "@lib/shared/search";

export const memoryTitle = (memory: Memory) => {
  return noteTitle(memory.content, memory.enrichment?.title) || "Untitled note";
};

export const noteKindLabel = (kind: Memory["kind"]) =>
  ({
    fact: "Note",
    preference: "Preference",
    decision: "Decision",
    solution: "How-to",
    handoff: "Progress note",
  })[kind];

export const memoryExcerpt = (
  memory: Pick<Memory, "content">,
  length = 160,
) => {
  return plainExcerpt(memory.content, length);
};

export const isInactive = (memory: Memory) =>
  memory.status === "archived" ||
  !!(memory.expiresAt && new Date(memory.expiresAt).getTime() <= Date.now());

/** Moving a memory is a correction, preserving its content and provenance. */
export const moveMemoryInput = (memory: Memory, projectId: string | null) => ({
  id: memory.id,
  expectedVersion: memory.version,
  content: memory.content,
  kind: memory.kind,
  autoKind: memory.autoKind ?? false,
  retentionDays: memory.retentionDays ?? (memory.expiresAt ? 30 : null),
  projectId,
  ...(memory.taskId ? { taskId: memory.taskId } : {}),
  source: memory.source,
});

export const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
