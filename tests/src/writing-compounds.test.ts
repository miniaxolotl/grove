import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyWritingEdit,
  createEnglishChecker,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const asset = (file: string) =>
  readFileSync(
    new URL(
      `../../packages/website/public/dictionaries/${file}`,
      import.meta.url,
    ),
    "utf8",
  );
const checker = createEnglishChecker({
  aff: asset("en.aff"),
  dic: asset("en.dic"),
});
const settings = writingSettingsSchema.parse({
  words: ["Zorblek-Tavli", "Flenwick"],
});

test("ordinary hyphenated words and personal terms work with typographic hyphens", () => {
  for (const hyphen of ["-", "‐", "‑"]) {
    const text =
      "Open the read-only link to the state-of-the-art, Flenwick-based Zorblek-Tavli model.".replaceAll(
        "-",
        hyphen,
      );
    assert.deepEqual(checker.check(text, settings).issues, []);
  }
});

test("a component edit keeps the original hyphens, casing, and surrounding text", () => {
  for (const hyphen of ["-", "‐", "‑"]) {
    const source = `📌 The file is read${hyphen}onyl. Ignore \`read-onyl\`.`;
    const issues = checker.check(source, settings).issues;
    assert.deepEqual(
      issues.map((i) => i.original),
      ["onyl"],
    );
    const issue = {
      ...issues[0],
      replacements: checker.suggest(issues[0].original),
    };
    assert.equal(
      applyWritingEdit(source, issue, "only"),
      source.replace("onyl", "only"),
    );
  }
});
