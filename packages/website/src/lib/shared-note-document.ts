import { noteOutline } from "./note-headings";

/** Derive targets before hiding a repeated title, retaining duplicate suffixes. */
export function sharedNoteDocument(source: string, title: string) {
  const match = source.match(/^\s*#{1,6}\s+([^\n]*)(?:\n|$)/);
  const removed = match && match[1] === title ? match[0].length : 0;
  const targets = noteOutline(source);
  return {
    targets,
    titleAnchor: removed
      ? targets.find((target) => target.from < removed)?.id
      : undefined,
    content: source.slice(removed),
    headings: targets
      .filter((target) => target.from >= removed)
      .map((target) => ({ ...target, from: target.from - removed })),
  };
}
