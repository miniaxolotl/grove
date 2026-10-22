import type { Memory } from "@lib/shared/contracts";

export const memoryTitle = (memory: Memory) => {
  const firstLine = memory.content.trim().split("\n")[0];
  const heading = firstLine.match(/^#{1,6}\s+(.+)/)?.[1].trim();
  return (
    heading?.slice(0, 110) ||
    memory.enrichment?.title ||
    firstLine.slice(0, 110) ||
    "Untitled note"
  );
};

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
    .trim()
    .replace(/^#{1,6}[ \t]+[^\n]+\n+/, "")
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm, "")
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, "")
    .replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/gm, "")
    .replace(/!?\[([^\]\n]+)\]\([^\n)]*\)/g, "$1")
    .replace(/[#*`_]/g, "")
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
