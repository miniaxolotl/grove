import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  createEnglishChecker,
  writingSettingsSchema,
  type WritingRule,
} from "../../lib/shared/src/writing-core.ts";

// Grammar runs independently of dictionary coverage.
const checker = createEnglishChecker({ aff: "SET UTF-8\n", dic: "1\nnote\n" });
const settings = writingSettingsSchema.parse({ spelling: false });
const issuesFor = (source: string, rule: WritingRule) =>
  checker.check(source, settings).issues.filter((issue) => issue.rule === rule);

for (const [rule, source] of [
  ["articles", "Assign a `Retry` action."],
  ["agreement", "The flag she `set` is local; the flags she `set` are shared."],
  ["agreement", "Who are we\r\n\r\nIs this still the right heading?"],
  ["confusion", "We logged its `size` this morning."],
  ["repetition", "Copy the `id` the job returned."],
  ["plurals", "The API’s `options` are stable."],
  ["agreement", "We should of course wait for review."],
  ["agreement", "The bridge must of necessity remain closed."],
  ["agreement", "If she were available, I would call."],
  ["agreement", "I wish it were simpler."],
  ["agreement", "Doesn't she have a key?"],
  ["agreement", "Why can’t it work offline?"],
  ["agreement", "We need to make it work offline."],
  ["agreement", "Let it go for now."],
  ["plurals", "Compare 2024’s totals with 2020's budget."],
] as const) {
  test(`${rule} leaves this note alone: ${source}`, () => {
    assert.deepEqual(issuesFor(source, rule), []);
  });
}

for (const [rule, source, corrected] of [
  ["repetition", "📌 Save the the note.", "📌 Save the note."],
  ["agreement", "He don’t have a key.", "He doesn’t have a key."],
  ["agreement", "They doesn’t have a key.", "They don’t have a key."],
  ["confusion", "Their been waiting.", "They’ve been waiting."],
  ["confusion", "Your been offline.", "You’ve been offline."],
  ["articles", "Add a\r\noptional field.", "Add an\r\noptional field."],
  ["agreement", "It were offline.", "It was offline."],
  ["agreement", "We should of waited.", "We should have waited."],
  ["plurals", "The 1990’s were different.", "The 1990s were different."],
  ["plurals", "A photo from the 1980's.", "A photo from the 1980s."],
] as const) {
  test(`${rule} offers an exact edit: ${source}`, () => {
    const issues = issuesFor(source, rule);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.equal(
      applyWritingEdit(source, issue, issue.replacements[0]),
      corrected,
    );
  });
}
