import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({
  words: ["Zorblek-Tavli", "Flenwick"],
});

test("ordinary hyphenated words and personal terms work with typographic hyphens", async () => {
  for (const hyphen of ["-", "‐", "‑"]) {
    const text =
      "Open the read-only link to the state-of-the-art, Flenwick-based Zorblek-Tavli model.".replaceAll(
        "-",
        hyphen,
      );
    assert.deepEqual((await checker.check(text, settings)).issues, []);
  }
});

test("a component edit keeps the original hyphens, casing, and surrounding text", async () => {
  for (const hyphen of ["-", "‐", "‑"]) {
    const source = `📌 The file is read${hyphen}onyl. Ignore \`read-onyl\`.`;
    const issues = (await checker.check(source, settings)).issues;
    assert.deepEqual(
      issues.map((i) => i.original),
      ["onyl"],
    );
    const issue = {
      ...issues[0],
      replacements: issues[0].replacements,
    };
    assert.equal(
      applyWritingEdit(source, issue, "only"),
      source.replace("onyl", "only"),
    );
  }
});
