import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

/** Project code ranges onto raw source. Rendered code values normalize whitespace
 * and cannot be used to calculate writing-edit offsets. */
export function maskMarkdownCode(
  source: string,
  hide: (value: string) => string,
) {
  // Keep the checker's indented-line policy, but test the original indentation:
  // spaces inserted for a span at line start must never hide the prose after it.
  const indented = source.replace(/(?:^|[\r\n])(?: {4}|\t)[^\r\n]*/g, hide);
  if (!source.includes("`") && !source.includes("~~~")) return indented;

  // micromark discards an initial BOM before assigning positions.
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const pending: Nodes[] = [fromMarkdown(source)];
  const parts: string[] = [];
  let cursor = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position!.start.offset! + bom;
      const end = node.position!.end.offset! + bom;
      parts.push(indented.slice(cursor, start), hide(source.slice(start, end)));
      cursor = end;
    } else if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--)
        pending.push(node.children[i]!);
    }
  }
  return parts.join("") + indented.slice(cursor);
}
