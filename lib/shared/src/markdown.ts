import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
export type { Nodes as MarkdownNode } from "mdast";

/** Parse the note's Markdown projection, never raw HTML or remote resources. */
export function parseNoteMarkdown(source: string) {
  if (source.length > 6000)
    throw new Error("Note exceeds the 6,000-character limit");
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}
