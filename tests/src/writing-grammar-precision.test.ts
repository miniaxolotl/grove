import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({ spelling: false });
const issuesFor = async (source: string, rule: "confusion" | "redundancy") =>
  (await checker.check(source, settings)).issues.filter((issue) => issue.rule === rule);

for (const [rule, source] of [
  ["confusion", "After you and I met, things changed."],
  ["confusion", "My colleague from Rome and I share an office."],
  ["confusion", "My colleague from Rome and I, both musicians, performed."],
  ["confusion", "She spoke to Sam and I listened."],
  ["confusion", "The last to speak were Sam and I."],
  ["confusion", "Prices were higher then."],
  ["confusion", "If you feel better then we can leave."],
  ["confusion", "I want to know whether to report the weather or not."],
  ["confusion", "Cyclists rode by in large groups."],
  ["redundancy", "We need more smaller boxes."],
  ["redundancy", "I'll say more later."],
  ["redundancy", "Most best practices change over time."],
  ["redundancy", "They won the most best actor awards."],
] as const) {
  test(`preserves ${rule} contrast: ${source}`, async () => {
    assert.deepEqual(await issuesFor(source, rule), []);
  });
}

for (const [rule, source, corrected] of [
  [
    "confusion",
    "Keep this between you and I.",
    "Keep this between you and me.",
  ],
  [
    "confusion",
    "A gift from my mother and I.",
    "A gift from my mother and me.",
  ],
  ["confusion", "It is bigger then that.", "It is bigger than that."],
  [
    "confusion",
    "Weather or not we go depends on the roads.",
    "Whether or not we go depends on the roads.",
  ],
  ["confusion", "By in large, we agree.", "By and large, we agree."],
  ["redundancy", "She is more smarter than me.", "She is smarter than me."],
  ["redundancy", "It was the most biggest day.", "It was the biggest day."],
  ["redundancy", "We meet on a regular basis.", "We meet regularly."],
] as const) {
  test(`applies a complete ${rule} edit: ${source}`, async () => {
    const issues = await issuesFor(source, rule);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.equal(
      applyWritingEdit(source, issue, issue.replacements[0]),
      corrected,
    );
  });
}
