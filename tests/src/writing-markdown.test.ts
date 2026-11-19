import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  prose,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

// Each fixture identifies the exact source range to suppress; every code unit
// outside that range (including unmatched delimiters) must survive verbatim.
for (const [name, before, code, after] of [
  ["immediate closing fence", "", "```\n```", "\nKeep this."],
  [
    "matching fence character and minimum width",
    "Before\n",
    "  ~~~~lang `x`\n~~~\n```\n~~~~ text\n    ~~~~\ninside\n ~~~~~\t",
    "\nAfter",
  ],
  ["open fence through EOF", "Before\r", "```lang\rinside📌", ""],
  ["opener alone at EOF", "Before\n", "~~~lang", ""],
  ["unclosed fence ends with its quote", "> ", "```\n> inside", "\n\nOutside"],
  [
    "invalid backtick info string is an inline span",
    "",
    "``` aa ```",
    "\nKeep this.",
  ],
  ["span at line start leaves trailing prose", "", "`term`", " is useful."],
  ["different-width runs inside span", "Say ", "`` a ` b ``` c ``", " here."],
  ["soft line break inside span", "📌 ", "``first😀\r\nsecond``", " remains."],
  ["unmatched run before a later pair", "`foo", "``bar``", " end"],
  ["backslash inside span is literal", "", "`foo\\`", "bar`"],
  ["escaped opener", "Keep \\`literal` words.", "", ""],
  ["mismatched runs", "```foo``", "", ""],
  ["no span across a paragraph break", "`foo\r\n  \r\nbar`", "", ""],
  ["no span across list items", "- `first\n- second`", "", ""],
  ["leading byte order mark", "\uFEFF", "``x ` y``", " follows."],
] as const) {
  test(`Markdown code mask: ${name}`, () => {
    const source = before + code + after;
    assert.equal(prose(source), before + code.replace(/[^\r\n]/g, " ") + after);
  });
}

test("only the prose after multiline code receives an exact grammar edit", async () => {
  const source = "📌 ``a apple `\r\na apple`` then a apple.";
  const issues = (
    await checker.check(
      source,
      writingSettingsSchema.parse({ spelling: false }),
    )
  ).issues.filter((i) => i.rule === "articles");
  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.from, source.lastIndexOf("a apple"));
  assert.equal(issue.to, issue.from + 1);
  assert.equal(
    applyWritingEdit(source, issue, "an"),
    "📌 ``a apple `\r\na apple`` then an apple.",
  );
});
