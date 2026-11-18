import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({ spelling: false });
const articles = async (text: string) =>
  (await checker.check(text, settings))
    .issues.filter((issue) => issue.rule === "articles");

for (const [correct, phrase] of [
  ["a", "one-time fee"],
  ["a", "onesie"],
  ["an", "onerous task"],
  ["an", "unidentified object"],
  ["a", "unified view"],
  ["a", "eulogy"],
  ["a", "ewe"],
  ["a", "ubiquitous problem"],
  ["a", "utensil"],
  ["an", "honourable mention"],
  ["an", "heirloom"],
  ["a", "UI change"],
  ["a", "UFO sighting"],
  ["a", "NASA mission"],
  ["a", "N.A.S.A. mission"],
  ["an", "MBA program"],
  ["an", "SMS alert"],
  ["an", "F.B.I. agent"],
  ["a", "U.S. resident"],
  ["an", "MRI-guided procedure"],
  ["a", "UI-only change"],
  ["an", "x-ray"],
  ["an", "L-shaped desk"],
  ["an", "L‑shaped desk"],
  ["a", "U-turn"],
] as const) {
  test(`offers the article-only edit for ${correct} ${phrase}`, async () => {
    const wrong = correct === "a" ? "an" : "a";
    const prefix = "📌 Consider ";
    const source = `${prefix}${wrong} ${phrase}.`;
    const corrected = `${prefix}${correct} ${phrase}.`;
    const issues = await articles(source);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.equal(issue.from, prefix.length);
    assert.equal(issue.original, wrong);
    assert.deepEqual(issue.replacements, [correct]);
    assert.equal(applyWritingEdit(source, issue, correct), corrected);
    assert.deepEqual(await articles(corrected), []);
  });
}

for (const phrase of [
  "SQL query",
  "sql query",
  "SQL-backed tool",
  "S.Q.L. query",
  "SQLite query",
  "FAQ entry",
  "URL shortener",
  "XYZ-branded item",
  "herb garden",
  "herbal tea",
  "H-shaped frame",
  "HTML file",
  "historic occasion",
  "homage",
  "unionized sample",
]) {
  test(`abstains for either pronunciation of ${phrase}`, async () => {
    for (const article of ["a", "an"]) {
      assert.deepEqual(await articles(`Consider ${article} ${phrase}.`), []);
    }
  });
}

test("does not treat a letter grade as a second article", async () => {
  assert.deepEqual(await articles("She earned an A in English."), []);
});
