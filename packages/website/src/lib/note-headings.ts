import { parseNoteMarkdown } from "@lib/shared/markdown";
import { NOTE_CONTENT_MAX } from "@lib/shared/limits";
import type { Nodes } from "mdast";

export type NoteHeading = {
  id: string;
  title: string;
  level: number;
  from: number;
  point?: boolean;
};

function text(node: Nodes): string {
  if (node.type === "html") return "";
  if ("children" in node) return node.children.map(text).join("");
  return "value" in node
    ? node.value
    : node.type === "image" || node.type === "imageReference"
      ? (node.alt ?? "")
      : "";
}

/** One CommonMark/GFM model for source positions, rendering and navigation. */
export function noteHeadings(source: string): NoteHeading[] {
  return collectOutline(source, false);
}

/** Headings and top-level list points share one source-position index. */
export function noteOutline(source: string): NoteHeading[] {
  return collectOutline(source, true);
}
function collectOutline(source: string, includePoints: boolean): NoteHeading[] {
  // Headings are a derived view (outline, PDF titles), not save validation:
  // allow large documents here; the save path enforces NOTE_CONTENT_MAX.
  if (source.length > NOTE_CONTENT_MAX) return [];
  const tree = parseNoteMarkdown(source);
  const headings: NoteHeading[] = [];
  const used = new Set<string>();
  const suffixes = new Map<string, number>();
  let sectionLevel = 1;
  let pointNumber = 0;
  function visit(node: Nodes, inList = false) {
    if (node.type === "heading") {
      sectionLevel = node.depth;
      const title = text(node).replace(/\s+/g, " ").trim();
      const slug =
        title
          .normalize("NFC")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "heading";
      const base = `section-${slug}`;
      let id = base;
      let suffix = suffixes.get(base) ?? 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      suffixes.set(base, suffix);
      used.add(id);
      headings.push({
        id,
        title: title || "Untitled heading",
        level: node.depth,
        from: node.position?.start.offset ?? 0,
      });
    }
    if (includePoints && node.type === "list" && !inList) {
      for (const item of node.children) {
        headings.push({
          id: `point-${++pointNumber}`,
          title:
            item.children
              .filter((child) => child.type !== "list")
              .map(text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim() || "List item",
          level: Math.min(6, sectionLevel + 1),
          from: item.position?.start.offset ?? 0,
          point: true,
        });
      }
    }
    if ("children" in node)
      node.children.forEach((child) =>
        visit(child, inList || node.type === "list"),
      );
  }
  visit(tree);
  return headings.sort((a, b) => a.from - b.from);
}

export function headingFromHash(hash: string) {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

export function filterOutline(headings: NoteHeading[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return headings.filter((heading) =>
    words.every((word) => heading.title.toLowerCase().includes(word)),
  );
}
