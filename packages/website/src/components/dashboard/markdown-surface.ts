import { EditorSelection, type Range } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

function decorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { doc, selection } = view.state;
  const active = (from: number, to: number) =>
    selection.ranges.some(
      (range) =>
        doc.lineAt(range.from).from <= to && doc.lineAt(range.to).to >= from,
    );
  syntaxTree(view.state).iterate({
    enter(node) {
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        ranges.push(
          Decoration.line({
            class: `cm-note-heading cm-note-h${heading[1]}`,
          }).range(doc.lineAt(node.from).from),
        );
      }
      if (node.name === "Blockquote") {
        for (let pos = doc.lineAt(node.from).from; pos <= node.to; ) {
          ranges.push(Decoration.line({ class: "cm-note-quote" }).range(pos));
          const line = doc.lineAt(pos);
          if (line.to >= doc.length) break;
          pos = line.to + 1;
        }
      }
      const parent = node.node.parent;
      const inlineMark =
        ["HeaderMark", "EmphasisMark", "LinkMark", "QuoteMark"].includes(
          node.name,
        ) ||
        (node.name === "CodeMark" && parent?.name === "InlineCode") ||
        (node.name === "URL" && parent?.name === "Link");
      if (
        inlineMark &&
        parent?.name !== "Image" &&
        !active(node.from, node.to)
      ) {
        ranges.push(Decoration.replace({}).range(node.from, node.to));
      }
    },
  });
  return Decoration.set(ranges, true);
}

export const liveMarkdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = decorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function wrapSelection(
  view: EditorView,
  before: string,
  after = before,
  fallback = "text",
) {
  if (view.state.readOnly) return false;
  view.dispatch({
    ...view.state.changeByRange((range) => {
      const selected = view.state.sliceDoc(range.from, range.to);
      let from = range.from,
        to = range.to;
      let insert = before + (selected || fallback) + after;
      let start = from + before.length,
        end = start + (selected || fallback).length;
      if (
        selected.startsWith(before) &&
        selected.endsWith(after) &&
        selected.length >= before.length + after.length
      ) {
        insert = selected.slice(before.length, selected.length - after.length);
        start = from;
        end = from + insert.length;
      } else if (
        from >= before.length &&
        view.state.sliceDoc(from - before.length, from) === before &&
        view.state.sliceDoc(to, to + after.length) === after
      ) {
        from -= before.length;
        to += after.length;
        insert = selected;
        start = from;
        end = from + selected.length;
      }
      return {
        changes: { from, to, insert },
        range: EditorSelection.range(start, end),
      };
    }),
    annotations: isolateHistory.of("full"),
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function prefixLines(view: EditorView, prefix: string) {
  if (view.state.readOnly) return false;
  const range = view.state.selection.main;
  const from = view.state.doc.lineAt(range.from).from;
  const to = view.state.doc.lineAt(
    range.to > range.from && view.state.doc.lineAt(range.to).from === range.to
      ? range.to - 1
      : range.to,
  ).to;
  const lines = view.state.sliceDoc(from, to).split("\n");
  const remove = lines.every((line) => line.startsWith(prefix));
  const insert = lines
    .map((line) =>
      remove
        ? line.slice(prefix.length)
        : prefix +
          (prefix.startsWith("#") ? line.replace(/^#{1,6}\s+/, "") : line),
    )
    .join("\n");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from, head: from + insert.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}
