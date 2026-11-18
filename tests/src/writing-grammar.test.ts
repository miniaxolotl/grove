import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  writingSettingsSchema,
  type WritingRule,
} from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({ spelling: false });
const issuesFor = async (source: string, rule: WritingRule) =>
  (await checker.check(source, settings)).issues.filter((issue) => issue.rule === rule);

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
  ["agreement", "I have saw blades. I have rose petals. I have read the note."],
  ["agreement", "The notes I have went missing yesterday."],
  ["agreement", "I’ve `never` wrote about it here."],
  ["confusion", "These are the tools we use to make pottery."],
  ["confusion", "What should I use to open it?"],
  ["confusion", "I didn’t use to drink coffee."],
  ["confusion", "I suppose to some extent it depends."],
  ["quotes", "We played ’90s records from the class of '94."],
  ["quotes", "She said, ‘I remember the ’80s.’"],
] as const) {
  test(`${rule} leaves this note alone: ${source}`, async () => {
    assert.deepEqual(await issuesFor(source, rule), []);
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
  ["agreement", "I’ve wrote the list.", "I’ve written the list."],
  ["agreement", "She has went home.", "She has gone home."],
  ["agreement", "We had chose the date.", "We had chosen the date."],
  ["agreement", "He hasn't took a break.", "He hasn't taken a break."],
] as const) {
  test(`${rule} offers an exact edit: ${source}`, async () => {
    const issues = await issuesFor(source, rule);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.equal(
      applyWritingEdit(source, issue, issue.replacements[0]),
      corrected,
    );
  });
}
