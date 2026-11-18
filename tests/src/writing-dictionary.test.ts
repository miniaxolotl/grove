import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createEnglishChecker,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

// Exercise the same affix rules and words loaded by the website worker.
const dictionary = new URL(
  "../../packages/website/public/dictionaries/",
  import.meta.url,
);
const checker = createEnglishChecker({
  aff: await readFile(new URL("en.aff", dictionary), "utf8"),
  dic: await readFile(new URL("en.dic", dictionary), "utf8"),
});
const settings = writingSettingsSchema.parse({ grammar: false });

test("Watchlist and common note vocabulary are recognized without accepting arbitrary compounds", () => {
  const source = [
    "# Watchlist",
    "Compare both watchlists with the audiobook wishlist.",
    "Save the livestream permalink and the screenshot's caption.",
    "Review the watchlist’s backlinks, roadmap subtasks and handoff walkthrough.",
    "Check the watchbucket and the Wtachlists.",
  ].join("\n");
  const issues = checker.check(source, settings).issues;
  assert.deepEqual(
    issues.map((issue) => issue.original),
    ["watchbucket", "Wtachlists"],
  );
  for (const issue of issues) {
    assert.equal(source.slice(issue.from, issue.to), issue.original);
    assert.deepEqual(issue.replacements, []);
  }
});

test("dictionary suggestions correct note words and preserve a possessive’s apostrophe style", () => {
  for (const [typo, correction] of [
    ["Watchlsit", "Watchlist"],
    ["watchlst", "watchlist"],
    ["Watchlst’s", "Watchlist’s"],
    ["watchlst's", "watchlist's"],
    ["backlnik", "backlink"],
  ]) {
    assert.equal(checker.suggest(typo)[0], correction, typo);
  }
});

test("personal names and acronyms keep their singular possessive without masking other suffixes", () => {
  const source =
    "Bramblewick’s notes on the API's limits and the SDK’s roadmap. Bramblewick’ll share Zorbleck’s notes.";
  const issues = checker.check(source, {
    ...settings,
    words: ["Bramblewick"],
  }).issues;
  assert.deepEqual(
    issues.map((issue) => issue.original),
    ["Bramblewick’ll", "Zorbleck’s"],
  );
  assert.deepEqual(
    checker
      .check("Bramblewick’s notes", settings)
      .issues.map((issue) => issue.original),
    ["Bramblewick’s"],
  );
});
