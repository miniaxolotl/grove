import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Nodes } from "mdast";

export type NoteHeading = {
  id: string;
  title: string;
  level: number;
  from: number;
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
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const headings: NoteHeading[] = [];
  const used = new Set<string>();
  function visit(node: Nodes) {
    if (node.type === "heading") {
      const title = text(node).replace(/\s+/g, " ").trim();
      const slug =
        title
          .normalize("NFC")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "heading";
      const base = `section-${slug}`;
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);
      headings.push({
        id,
        title: title || "Untitled heading",
        level: node.depth,
        from: node.position?.start.offset ?? 0,
      });
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(tree);
  return headings;
}

export function headingFromHash(hash: string) {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}
