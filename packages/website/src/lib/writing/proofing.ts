import {
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { WritingIssue } from "@lib/shared/writing-settings";

/**
 * CodeMirror decorations for local proofing issues.
 *
 * One shared engine produces the issues; this field only renders them.
 * Spelling uses a wavy red underline, grammar a dotted green one — always
 * paired with a text label in the issue card, never color alone.
 */
export const setWritingIssues = StateEffect.define<WritingIssue[]>();

const spellingMark = Decoration.mark({
  class: "grove-writing-spelling",
  attributes: { "data-grove-writing": "spelling" },
});
const grammarMark = Decoration.mark({
  class: "grove-writing-grammar",
  attributes: { "data-grove-writing": "grammar" },
});

function buildDecorations(issues: WritingIssue[]) {
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.mark>>();
  for (const issue of [...issues].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  )) {
    if (
      !Number.isInteger(issue.from) ||
      !Number.isInteger(issue.to) ||
      issue.from < 0 ||
      issue.to <= issue.from
    )
      continue;
    builder.add(
      issue.from,
      issue.to,
      issue.rule === "spelling" ? spellingMark : grammarMark,
    );
  }
  return builder.finish();
}

export const writingField = StateField.define<ReturnType<typeof buildDecorations>>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setWritingIssues)) return buildDecorations(effect.value);
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
