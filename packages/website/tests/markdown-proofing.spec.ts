import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { expect, test } from "@playwright/test";
import {
  projectMarkdownParagraph,
  protectMarkdownIssues,
} from "../src/lib/writing/markdown-proofing";

function editor(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
}

test("formatted labels remain editable without exposing destinations or changing Markdown offsets", () => {
  const source =
    '# Plan\n\n- [ ] 😀 [**teh** guide](https://example.org/secret(foo) "private") and `hidden` follow-up.';
  const state = editor(source),
    from = source.indexOf("teh");
  const projection = projectMarkdownParagraph(state, from, 1500)!;
  expect(projection.text).toContain("teh");
  for (const hidden of [
    "private",
    "secret",
    "https:",
    "hidden",
    "**",
    "[",
    "]",
    "`",
  ])
    expect(projection.text).not.toContain(hidden);
  const offset = from - projection.from;
  expect(projection.text.indexOf("teh")).toBe(offset);
  expect(projection.allows(offset, offset + 3)).toBe(true);
  expect(projection.allows(offset - 1, offset + 3)).toBe(false);
  for (const token of ["secret(foo)", "private", "hidden"]) {
    expect(
      projectMarkdownParagraph(state, source.indexOf(token) + 1, 1500),
    ).toBeNull();
  }
  const issue = {
    id: "spelling",
    rule: "spelling",
    message: "spelling",
    original: "teh",
    from,
    to: from + 3,
    replacements: ["the"],
  } as const;
  const change = { ...issue, replacements: [...issue.replacements] };
  expect(protectMarkdownIssues(state, [change])).toEqual([change]);
  const corrected = state.update({
    changes: { from, to: from + 3, insert: "the" },
  }).state;
  expect(corrected.doc.toString()).toBe(source.replace("teh", "the"));
  expect(protectMarkdownIssues(corrected, [change])).toEqual([]);
});

test("check the selected cell or paragraph, never code blocks, definitions or front matter", () => {
  const source =
    "---\nsecret: value\n---\n\n```ts\nsecret_code\n```\n\n[id]: /secret-ref\n\n| Key | Next |\n| --- | --- |\n| teh | adjacent |\n\n> Other paragraph";
  const state = editor(source);
  for (const s of ["value", "secret_code", "secret-ref"])
    expect(
      projectMarkdownParagraph(state, source.indexOf(s) + 1, 1500),
    ).toBeNull();
  const projection = projectMarkdownParagraph(
    state,
    source.indexOf("teh") + 1,
    1500,
  )!;
  expect(projection.text.trim()).toBe("teh");
  expect(
    projectMarkdownParagraph(state, source.indexOf("paragraph"), 3),
  ).toBeNull();
});

test("reject partial graphemes and unfinished link destinations", () => {
  const text = "Emoji 😀 and Cafe\u0301.";
  const projection = projectMarkdownParagraph(editor(text), 3, 1500)!;
  expect(projection.allows(6, 7)).toBe(false);
  expect(projection.allows(6, 8)).toBe(true);
  expect(projection.allows(text.indexOf("Cafe"), text.indexOf("\u0301"))).toBe(
    false,
  );
  expect(
    projectMarkdownParagraph(editor("See [label](partial-secret"), 2, 1500),
  ).toBeNull();
});

test("an image description is prose; its attachment address and link title are not", () => {
  const source = 'See ![teh draft](grove-media:1234 "hidden title") today.';
  const at = source.indexOf("teh");
  const block = projectMarkdownParagraph(editor(source), at, 1500)!;
  expect(block.text).toContain("teh draft");
  expect(block.text).not.toMatch(/grove-media|1234|hidden/);
  expect(block.allows(at - block.from, at + 3 - block.from)).toBe(true);
  expect(block.allows(at - 1 - block.from, at + 3 - block.from)).toBe(false);
});
