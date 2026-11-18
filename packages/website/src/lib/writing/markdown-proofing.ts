import { ensureSyntaxTree } from "@codemirror/language";
import { type EditorState, findClusterBreak } from "@codemirror/state";
import {
  projectWritingText,
  type WritingIssue,
} from "@lib/shared/writing-settings";

const blocks = /^(Paragraph|Task|TableCell|(?:ATX|Setext)Heading[1-6])$/;
const hidden =
  /(?:Mark|Marker)$|^(URL|LinkTitle|LinkLabel|InlineCode|Autolink|HTMLTag|Comment|Entity|Escape|ProcessingInstruction|HardBreak|Emoji)$/;

// Lezer treats YAML front matter as Markdown. Treat its contents as metadata,
// including an unfinished preamble, rather than sending values to a checker.
const frontMatterEnds = new WeakMap<EditorState["doc"], number>();
function frontMatterEnd({ doc }: EditorState) {
  const cached = frontMatterEnds.get(doc);
  if (cached !== undefined) return cached;
  let end = 0;
  if (doc.line(1).text.trimEnd() === "---") {
    end = doc.length;
    for (let line = 2; line <= doc.lines; line++) {
      const next = doc.line(line);
      if (/^(?:---|\.\.\.)\s*$/.test(next.text)) {
        end = next.to;
        break;
      }
    }
  }
  frontMatterEnds.set(doc, end);
  return end;
}

/** Project one editable prose block, preserving CodeMirror's UTF-16 offsets. */
export function projectMarkdownParagraph(
  state: EditorState,
  at: number,
  maxUnits: number,
) {
  if (
    !Number.isSafeInteger(at) ||
    at < frontMatterEnd(state) ||
    at < 0 ||
    at > state.doc.length ||
    !Number.isSafeInteger(maxUnits) ||
    maxUnits < 1
  )
    return null;
  // Don't serialize an arbitrary fragment when the editor hasn't parsed it yet.
  const tree = ensureSyntaxTree(
    state,
    Math.min(state.doc.length, at + maxUnits + 1),
    12,
  );
  if (!tree) return null;
  let node = tree.resolve(
    at,
    at < state.doc.length && state.doc.lineAt(at).from === at ? 1 : -1,
  );
  while (!blocks.test(node.name)) {
    // Editing code, an attachment address or another hidden token must not
    // trigger a check of the prose surrounding it. A caret exactly at the
    // end of a closing delimiter may legitimately be typing outside it.
    if (hidden.test(node.name) && at >= node.from && at < node.to) return null;
    if (!node.parent) return null;
    node = node.parent;
  }
  const { from, to } = node;
  if (to - from > maxUnits || from < frontMatterEnd(state)) return null;
  const original = state.sliceDoc(from, to);
  const masked = projectWritingText(original);
  const chars = masked.text.split("");
  const protectedUnits = new Uint8Array(chars.length);
  for (const span of masked.protectedSpans)
    protectedUnits.fill(1, span.from, span.to);
  tree.iterate({
    from,
    to,
    enter(child) {
      if (!hidden.test(child.name)) return;
      for (
        let i = Math.max(from, child.from) - from;
        i < Math.min(to, child.to) - from;
        i++
      ) {
        protectedUnits[i] = 1;
        if (chars[i] !== "\n") chars[i] = " ";
      }
      return false;
    },
  });
  const text = chars.join("");
  // A half-typed destination parses as a shortcut link followed by plain
  // text. Its `]` is hidden by Lezer but the following `(` is still visible.
  for (const marker of original.matchAll(/\]\s*\(/g)) {
    if (!protectedUnits[marker.index + marker[0].length - 1]) return null;
  }
  // Incomplete inline syntax has no reliable destination boundary yet.
  if (!text.trim() || /`|\]\s*\(|<!--|<\/?[A-Za-z]/.test(text)) return null;
  const boundaries = new Set<number>([0]);
  for (let i = 0; i < original.length; ) {
    i = findClusterBreak(original, i);
    boundaries.add(i);
  }
  return {
    from,
    to,
    text,
    allows(start: number, end: number) {
      return (
        start < end &&
        boundaries.has(start) &&
        boundaries.has(end) &&
        !protectedUnits.subarray(start, end).includes(1)
      );
    },
  };
}

/** Accept only fixes whose original span still belongs to visible prose. */
export function protectMarkdownIssues(
  state: EditorState,
  issues: readonly WritingIssue[],
): WritingIssue[] {
  let block: ReturnType<typeof projectMarkdownParagraph> = null;
  return issues.filter((issue) => {
    if (!block || issue.from < block.from || issue.from >= block.to)
      block = projectMarkdownParagraph(state, issue.from, 6000);
    return (
      !!block &&
      block.allows(issue.from - block.from, issue.to - block.from) &&
      state.sliceDoc(issue.from, issue.to) === issue.original
    );
  });
}
