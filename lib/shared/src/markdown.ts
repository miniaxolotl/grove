import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { NOTE_CONTENT_MAX } from "./limits.ts";
export type { Nodes as MarkdownNode } from "mdast";

/** Parse the note's Markdown projection, never raw HTML or remote resources. */
export function parseNoteMarkdown(
  source: string,
  opts?: { maxCharacters?: number },
) {
  const max = opts?.maxCharacters ?? NOTE_CONTENT_MAX;
  if (source.length > max)
    throw new Error(`Note exceeds the ${max.toLocaleString()}-character limit`);
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}
