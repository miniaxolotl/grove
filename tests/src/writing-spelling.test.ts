import { checker } from "./fixtures/harper-checker.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWritingEdit,
  writingSettingsSchema,
} from "../../lib/shared/src/writing-core.ts";

const settings = writingSettingsSchema.parse({ grammar: false });

test("recognizes accented English loanwords and their noun inflections in either canonical form", async () => {
  for (const form of ["NFC", "NFD"] as const) {
    const source =
      "The naïve fiancé reviewed the café’s façades, résumés and jalapeños.".normalize(
        form,
      );
    assert.deepEqual((await checker.check(source, settings)).issues, []);
  }
  const invalid = ["résuméing", "caféss", "jalapeñoss", "hóuse"];
  assert.deepEqual(
    (await checker.check(invalid.join(" "), settings)).issues.map((i) => i.original),
    invalid,
  );
});

test("corrects a decomposed typo at its literal UTF-16 span", async () => {
  const typo = "jalapeñso".normalize("NFD");
  const prefix = "📌 At the cafe\u0301, try ";
  const suffix = "‑stuffed olives.";
  const source = prefix + typo + suffix;
  const issues = (await checker.check(source, settings)).issues;
  assert.deepEqual(
    issues.map(({ from, to, original }) => [from, to, original]),
    [[prefix.length, prefix.length + typo.length, typo]],
  );
  const replacements = (await checker.check(typo, settings)).issues[0].replacements;
  assert.deepEqual(replacements, (await checker.check(typo.normalize("NFC"), settings)).issues[0].replacements);
  assert.equal(replacements[0], "jalapeños");
  assert.equal(
    applyWritingEdit(source, { ...issues[0], replacements }, replacements[0]),
    prefix + "jalapeños" + suffix,
  );
});

test("transposition ranking honors the shipped affix's NOSUGGEST flag", async () => {
  const suggestions = (await checker.check("hsit", settings)).issues[0].replacements;
  assert.ok(suggestions.includes("hist"));
  assert.ok(!suggestions.includes("shit"));
});

test("does not propose generated spelling changes for a correctly spelled word", async () => {
  assert.deepEqual((await checker.check("of", settings)).issues, []);
});

test("uses the adjective model and only the doubled past and participle of geotag", async () => {
  const source =
    "We naïvely geotagged the photos and kept geotagging. geotaged geotaging";
  assert.deepEqual(
    (await checker.check(source, settings)).issues.map((i) => i.original),
    ["geotaged", "geotaging"],
  );
});
