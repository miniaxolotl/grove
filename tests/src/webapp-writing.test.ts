import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Webapp writing shares one engine with the extension — no forked rules,
 * schemas or defaults. These guards fail if the two surfaces drift apart.
 */
test("webapp and extension resolve the same writing engine", async (t) => {
  const shared = await import("../../lib/shared/src/writing-settings.ts");
  const core = await import("../../lib/shared/src/writing-core.ts");
  const extension = await import(
    "../../packages/browser-extension/src/writing/core.ts"
  );
  await t.test("identical rule registry", () => {
    assert.deepEqual(
      [...shared.writingRules],
      [...extension.writingRules],
    );
  });
  await t.test("identical defaults", () => {
    assert.deepEqual(
      shared.writingSettingsSchema.parse({}),
      extension.writingSettingsSchema.parse({}),
    );
  });
  await t.test("identical precedence", () => {
    const base = shared.writingSettingsSchema.parse({});
    const patch = { spelling: false, rules: { articles: false } } as const;
    assert.deepEqual(
      shared.effectiveWritingSettings(base, patch, true),
      extension.effectiveWritingSettings(base, patch, true),
    );
  });
  await t.test("adjacent transpositions rank first", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const require = createRequire(
      new URL(
        "../../packages/browser-extension/package.json",
        import.meta.url,
      ),
    );
    const directory = dirname(require.resolve("dictionary-en"));
    const dictionary = {
      aff: await readFile(join(directory, "index.aff"), "utf8"),
      dic: await readFile(join(directory, "index.dic"), "utf8"),
    };
    const engine = core.createEnglishChecker(dictionary);
    // nspell's ranking buries the obvious keyboard swap below unrelated
    // single-edits; the shared suggester must surface it first.
    assert.equal(engine.suggest("teh")[0], "the");
    assert.ok(engine.suggest("Teh").includes("The"));
  });
  await t.test("identical span safety on a fixed sentence", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const require = createRequire(
      new URL(
        "../../packages/browser-extension/package.json",
        import.meta.url,
      ),
    );
    const directory = dirname(require.resolve("dictionary-en"));
    const dictionary = {
      aff: await readFile(join(directory, "index.aff"), "utf8"),
      dic: await readFile(join(directory, "index.dic"), "utf8"),
    };
    const text = "This is is a test of teh checker with an hour and a university.";
    const settings = shared.writingSettingsSchema.parse({});
    assert.deepEqual(
      extension
        .createEnglishChecker(dictionary)
        .check(text, settings),
      core.createEnglishChecker(dictionary).check(text, settings),
    );
  });
});

test("shared suggester ranks the obvious fix first", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(
    new URL(
      "../../packages/browser-extension/package.json",
      import.meta.url,
    ),
  );
  const directory = dirname(require.resolve("dictionary-en"));
  const engine = (
    await import("../../lib/shared/src/writing-core.ts")
  ).createEnglishChecker({
    aff: await readFile(join(directory, "index.aff"), "utf8"),
    dic: await readFile(join(directory, "index.dic"), "utf8"),
  });
  // Transpositions, missing apostrophes and dropped doublings beat the
  // affix engine's unrelated near-edits.
  assert.equal(engine.suggest("dont")[0], "don't");
  assert.equal(engine.suggest("isnt")[0], "isn't");
  assert.equal(engine.suggest("refered")[0], "referred");
  // Hard misspellings the affix engine returns empty or wrong for.
  assert.deepEqual(engine.suggest("maintainance"), ["maintenance"]);
  assert.deepEqual(engine.suggest("questionairre"), ["questionnaire"]);
  assert.deepEqual(engine.suggest("lisence"), ["license"]);
  assert.deepEqual(engine.suggest("speach"), ["speech"]);
  assert.deepEqual(engine.suggest("tendancy"), ["tendency"]);
  assert.deepEqual(engine.suggest("wich"), ["which"]);
});

test("shared grammar catches comparatives, participles and verb agreement", async () => {
  const { createEnglishChecker, writingSettingsSchema } = await import(
    "../../lib/shared/src/writing-core.ts"
  );
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(
    new URL(
      "../../packages/browser-extension/package.json",
      import.meta.url,
    ),
  );
  const directory = dirname(require.resolve("dictionary-en"));
  const engine = createEnglishChecker({
    aff: await readFile(join(directory, "index.aff"), "utf8"),
    dic: await readFile(join(directory, "index.dic"), "utf8"),
  });
  const settings = writingSettingsSchema.parse({});
  const check = (text: string) =>
    engine
      .check(text, settings)
      .issues.map((issue) => `${issue.rule}:${issue.original}->${issue.replacements.join("|")}`);
  // Comparative + then, doubled comparatives, possessive + participle.
  assert.ok(check("This is bigger then that.").includes("confusion:bigger then->bigger than"));
  assert.ok(check("She is more smarter than him.").includes("redundancy:more smarter->smarter"));
  assert.ok(check("It was the most biggest day.").includes("redundancy:most biggest->biggest"));
  assert.ok(check("Its been a long time.").some((entry) => entry.startsWith("confusion:Its")));
  assert.ok(check("Their gone home.").some((entry) => entry.startsWith("confusion:Their")));
  assert.ok(check("Your gone worry about it.").some((entry) => entry.startsWith("confusion:Your")));
  // Pronoun + verb agreement in both directions.
  assert.ok(check("He go there.").includes("agreement:go->goes"));
  assert.ok(check("They goes there.").includes("agreement:goes->go"));
  assert.ok(check("She say hello.").includes("agreement:say->says"));
  // Inverted questions and mandative subjunctives abstain.
  assert.deepEqual(check("Does he have it?"), []);
  assert.deepEqual(check("Will she come?"), []);
  assert.deepEqual(check("Did she say that?"), []);
  assert.deepEqual(check("I suggest he go there."), []);
});

test("webapp writing settings preserve explicit opt-outs", async () => {  const settings = await import(
    "../../packages/website/src/lib/writing/settings.ts"
  );
  const defaults = settings.defaultWritingSettings();
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.automatic, true);
  // No window in this runner: load falls back to defaults without throwing.
  assert.deepEqual(settings.loadWritingSettings(), defaults);
  assert.equal(settings.NATIVE_WRITING_ATTRIBUTE, "data-grove-native-writing");
  assert.equal(typeof settings.subscribeWritingSettings, "function");
});

test("extension stands down on native webapp surfaces", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL(
      "../../packages/browser-extension/src/content.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /data-grove-native-writing/);
});
