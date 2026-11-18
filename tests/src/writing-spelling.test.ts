import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyWritingEdit,
  createEnglishChecker,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const asset = (ext: string) =>
  readFileSync(
    new URL(
      `../../packages/website/public/dictionaries/en.${ext}`,
      import.meta.url,
    ),
    "utf8",
  );
const checker = createEnglishChecker({ aff: asset("aff"), dic: asset("dic") });
const settings = writingSettingsSchema.parse({ grammar: false });

test("recognizes accented English loanwords and their noun inflections in either canonical form", () => {
  for (const form of ["NFC", "NFD"] as const) {
    const source =
      "The naïve fiancé reviewed the café’s façades, résumés and jalapeños.".normalize(
        form,
      );
    assert.deepEqual(checker.check(source, settings).issues, []);
  }
  const invalid = ["résuméing", "caféss", "jalapeñoss", "hóuse"];
  assert.deepEqual(
    checker.check(invalid.join(" "), settings).issues.map((i) => i.original),
    invalid,
  );
});

test("corrects a decomposed typo at its literal UTF-16 span", () => {
  const typo = "jalapeñso".normalize("NFD");
  const prefix = "📌 At the cafe\u0301, try ";
  const suffix = "‑stuffed olives.";
  const source = prefix + typo + suffix;
  const issues = checker.check(source, settings).issues;
  assert.deepEqual(
    issues.map(({ from, to, original }) => [from, to, original]),
    [[prefix.length, prefix.length + typo.length, typo]],
  );
  const replacements = checker.suggest(typo);
  assert.deepEqual(replacements, checker.suggest(typo.normalize("NFC")));
  assert.equal(replacements[0], "jalapeños");
  assert.equal(
    applyWritingEdit(source, { ...issues[0], replacements }, replacements[0]),
    prefix + "jalapeños" + suffix,
  );
});

test("transposition ranking honors the shipped affix's NOSUGGEST flag", () => {
  const suggestions = checker.suggest("hsit");
  assert.ok(suggestions.includes("hist"));
  assert.ok(!suggestions.includes("shit"));
});

test("does not propose generated spelling changes for a correctly spelled word", () => {
  assert.deepEqual(checker.suggest("of"), []);
});

test("uses the adjective model and only the doubled past and participle of geotag", () => {
  const source =
    "We naïvely geotagged the photos and kept geotagging. geotaged geotaging";
  assert.deepEqual(
    checker.check(source, settings).issues.map((i) => i.original),
    ["geotaged", "geotaging"],
  );
});
