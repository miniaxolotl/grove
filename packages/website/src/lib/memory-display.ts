import type { Memory } from "@lib/shared/contracts";

export const memoryTitle = (memory: Memory) =>
  memory.enrichment?.title ||
  memory.content
    .trim()
    .split("\n")[0]
    .replace(/^#{1,6}\s+/, "")
    .slice(0, 110) ||
  "Untitled note";

export const noteKindLabel = (kind: Memory["kind"]) =>
  ({
    fact: "Note",
    preference: "Preference",
    decision: "Decision",
    solution: "How-to",
    handoff: "Progress note",
  })[kind];

export const memoryExcerpt = (memory: Memory, length = 160) => {
  const text = memory.content
    .replace(/^#{1,6} .+\n+/, "")
    .replace(/[#*`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
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
