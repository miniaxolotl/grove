import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../../lib/shared/src/writing-core.ts";
import corpus from "./fixtures/proofing-corpus.json" with { type: "json" };

test("local Harper returns bounded original UTF-16 edits and preserves clean controls", async () => {
  const settings = core.writingSettingsSchema.parse({});
  const wins: string[] = [],
    losses: string[] = [];
  for (const row of corpus) {
    const result = await checker.check(row.text, settings);
    assert.equal(result.complete, true);
    for (const i of result.issues)
      assert.equal(row.text.slice(i.from, i.to), i.original);
    if (!row.gold) assert.deepEqual(result.issues, [], row.id);
    else if (
      result.issues.some(
        (i) =>
          i.replacements.length &&
          core.applyWritingEdit(row.text, i, i.replacements[0]) === row.gold,
      )
    )
      wins.push(row.id);
    else if (row.legacyFirst) losses.push(row.id);
  }
  assert.deepEqual(losses, []);
  assert.ok(wins.length >= 27, wins.join(","));
});

// Legacy comparisons are judged by the resulting sentence, not a preferred
// tokenizer, the width of the underline or a typography-only apostrophe.
import styleExamples from "./fixtures/proofing-style.json" with { type: "json" };
import { checker } from "./fixtures/harper-checker.ts";
const defaults = core.writingSettingsSchema.parse({});
test("preserves first edits from the English note-writing style profile", async () => {
  const misses = [];
  for (const [text, gold] of styleExamples) {
    const { issues } = await checker.check(text, defaults);
    if (
      !issues.some(
        (i) =>
          i.replacements.length &&
          core
            .applyWritingEdit(text, i, i.replacements[0])
            .replaceAll("’", "'") === gold,
      )
    )
      misses.push(text);
  }
  assert.deepEqual(misses, []);
});
test("independent switches, personal words, and ignore-one use original UTF-16 coordinates", async () => {
  const text = "📌 Save teh flibbertix and a apple. `teh`";
  const check = (patch: Partial<core.WritingSettings>) =>
    checker.check(text, { ...defaults, ...patch });
  assert.deepEqual((await check({ enabled: false })).issues, []);
  const spell = (await check({ grammar: false, words: ["Flibbertix"] })).issues;
  assert.deepEqual(
    spell.map((i) => [i.original, i.replacements[0]]),
    [["teh", "the"]],
  );
  assert.equal((await check({ spelling: false })).issues[0].rule, "articles");
  assert.deepEqual(
    (
      await check({
        spelling: false,
        rules: { ...defaults.rules, articles: false },
      })
    ).issues,
    [],
  );
  assert.equal(
    core.mapIgnoredIssues(text, "New " + text, spell)[0].from,
    spell[0].from + 4,
  );
  assert.deepEqual(
    core.mapIgnoredIssues(text, text.replace("teh", "the"), spell),
    [],
  );
  assert.throws(() => core.applyWritingEdit("New " + text, spell[0], "the"));
  assert.throws(() => core.applyWritingEdit(text, spell[0], "not offered"));
  assert.ok((await check({})).issues.some((i) => i.original === "flibbertix"));
});
test("caps the check window and never edits a truncated word", async () => {
  const result = await checker.check("Teh sentnce. ".repeat(500), defaults);
  assert.equal(result.checkedTo, 6000);
  assert.equal(result.complete, false);
  assert.equal(result.issues.length, 50);
  assert.ok(result.issues.every((i) => i.to < result.checkedTo));
});
