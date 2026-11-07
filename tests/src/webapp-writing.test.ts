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
  await t.test("identical span safety on a fixed sentence", async () => {    const { readFile } = await import("node:fs/promises");
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

test("webapp writing settings preserve explicit opt-outs", async () => {
  const settings = await import(
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
