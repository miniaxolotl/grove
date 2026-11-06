import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { WritingPreferencesStore } from "../../packages/browser-extension/src/writing/preferences.ts";

const require = createRequire(
  new URL("../../packages/browser-extension/package.json", import.meta.url),
);
const modulePath = new URL(
  "../../packages/browser-extension/src/writing/core.ts",
  import.meta.url,
).href;

test("English writing core is local, language-scoped and conservative about edits", async (t) => {
  const core = await import(modulePath).catch(() => ({}));
  assert.equal(
    typeof core.createEnglishChecker,
    "function",
    "the local dictionary/rule engine must exist",
  );
  const dictionary = dirname(require.resolve("dictionary-en"));
  const aff = await readFile(join(dictionary, "index.aff"), "utf8");
  const dic = await readFile(join(dictionary, "index.dic"), "utf8");
  const checker = core.createEnglishChecker({ aff, dic });
  const settings = core.writingSettingsSchema.parse({});
  const check = (text: string, changes = {}) =>
    checker.check(text, { ...settings, ...changes });
  const rules = (text: string) =>
    check(text).issues.map((issue: { rule: string }) => issue.rule);

  await t.test(
    "English dictionary supplies real replacements without remote I/O",
    () => {
      const result = check("Hello world. This is a sentnce.");
      const issue = result.issues.find(
        (issue: { rule: string }) => issue.rule === "spelling",
      );
      assert.equal(issue.original, "sentnce");
      assert.deepEqual(
        issue.replacements,
        [],
        "typing checks must not enumerate spelling candidates",
      );
      assert.ok(checker.suggest(issue.original).includes("sentence"));
      assert.equal(result.language, "en");
      assert.equal(result.complete, true);
      assert.equal(
        check("The children were running through the gardens.").issues.length,
        0,
      );
    },
  );
  await t.test(
    "personal words and feature/rule switches stay independent",
    () => {
      assert.ok(rules("This is a zorbler.").includes("spelling"));
      assert.equal(
        check("This is a zorbler.", { words: ["zorbler"] }).issues.length,
        0,
      );
      assert.ok(
        check("This is a zorbler and a apple.", {
          spelling: false,
        }).issues.some((i: { rule: string }) => i.rule === "articles"),
      );
      assert.ok(
        check("This is a zorbler and a apple.", {
          grammar: false,
        }).issues.every((i: { rule: string }) => i.rule === "spelling"),
      );
      assert.ok(
        !check("This is a apple.", {
          rules: { ...settings.rules, articles: false },
        }).issues.some((i: { rule: string }) => i.rule === "articles"),
      );
      assert.equal(
        check("This is a zorbler.", { enabled: false }).issues.length,
        0,
      );
      assert.throws(() => core.writingSettingsSchema.parse({ language: "fr" }));
    },
  );
  await t.test("article rules use sounds and bounded exception sets", () => {
    for (const text of [
      "This is a apple.",
      "This is an university.",
      "This is a hour.",
      "This is a FBI agent.",
    ])
      assert.ok(rules(text).includes("articles"), text);
    for (const text of [
      "This is an apple.",
      "This is a university.",
      "This is an hour.",
      "This is a useful tool.",
      "This is a one-off.",
      "This is an FBI agent.",
      "This is a unicorn.",
      "This is a SQL query.",
    ])
      assert.ok(!rules(text).includes("articles"), text);
  });
  await t.test(
    "delimiters distinguish structural pairs from apostrophes and protected syntax",
    () => {
      for (const text of [
        "This (is wrong]",
        "This has a (bracket.",
        "This has a “quote.",
      ])
        assert.ok(
          rules(text).some((rule: string) =>
            ["brackets", "quotes"].includes(rule),
          ),
          text,
        );
      for (const text of [
        "This (is [fine]).",
        "Don't change John's notes.",
        "He said “hello.”",
        "He wrote 'notes'.",
        'He wrote "version2".',
        'A 6" ruler.',
        "This [link](https://example.com/a) is fine.",
        "This is `a apple (` code.",
      ])
        assert.ok(
          !rules(text).some((rule: string) =>
            ["brackets", "quotes", "articles"].includes(rule),
          ),
          text,
        );
    },
  );
  await t.test(
    "conservative repetition, spacing and capitalization rules",
    () => {
      assert.ok(rules("The the note is here.").includes("repetition"));
      assert.ok(
        !rules("The experience he had had was useful.").includes("repetition"),
      );
      assert.ok(rules("This is  wrong.").includes("spacing"));
      assert.ok(!rules("- This note\n  continues here.").includes("spacing"));
      assert.ok(rules("hello world.").includes("capitalization"));
      assert.ok(
        rules("This is fine. another sentence.").includes("capitalization"),
      );
      assert.ok(!rules("iPhone is a brand.").includes("capitalization"));
      assert.ok(!rules("Ask Dr. smith for a note.").includes("capitalization"));
      assert.ok(rules("Hello,world.").includes("spacing"));
      assert.ok(rules("This is fine. i agree.").includes("capitalization"));
    },
  );
  await t.test(
    "source ranges preserve emoji, CRLF and Markdown exclusions",
    () => {
      const text =
        "😀 This is a sentnce.\r\n`zorbler` https://example.com/zorbler [note](zorbler)";
      const result = check(text);
      assert.equal(
        result.issues.filter((i: { rule: string }) => i.rule === "spelling")
          .length,
        1,
      );
      for (const issue of result.issues)
        assert.equal(text.slice(issue.from, issue.to), issue.original);
      const issue = result.issues.find(
        (i: { original: string }) => i.original === "sentnce",
      );
      issue.replacements = checker.suggest(issue.original);
      assert.equal(
        core.applyWritingEdit(text, issue, "sentence"),
        text.replace("sentnce", "sentence"),
      );
      assert.throws(() =>
        core.applyWritingEdit("Changed " + text, issue, "sentence"),
      );
      assert.throws(() =>
        core.applyWritingEdit(text, issue, "unreviewed replacement"),
      );
      const ignored = [{ ...issue, replacements: [] }];
      assert.equal(
        typeof core.mapIgnoredIssues,
        "function",
        "ignored issues must follow unrelated edits without hiding changed text",
      );
      assert.equal(
        core.mapIgnoredIssues(text, text + " More text.", ignored).length,
        1,
      );
      assert.equal(
        core.mapIgnoredIssues(text, "Prefix " + text, ignored)[0].from,
        issue.from + 7,
      );
      assert.equal(
        core.mapIgnoredIssues(
          text,
          text.replace("sentnce", "new text"),
          ignored,
        ).length,
        0,
      );
      const long = check("This is fine. ".repeat(600));
      assert.equal(long.complete, false);
      assert.ok(long.checkedTo <= 6000);
    },
  );
  await t.test(
    "warm checks stay bounded and spelling alternatives are demand-only",
    () => {
      const text = "This zorbler has a flibber and a quaxler. ".repeat(180);
      const times = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        const result = check(text);
        times.push(performance.now() - start);
        assert.ok(result.issues.length <= 50);
        assert.ok(
          result.issues
            .filter((issue: { rule: string }) => issue.rule === "spelling")
            .every(
              (issue: { replacements: string[] }) =>
                issue.replacements.length === 0,
            ),
        );
      }
      times.sort((a, b) => a - b);
      // Broad regression ceiling, not a claim that a loaded CI host meets frame time.
      assert.ok(
        times[28] < 80,
        `warm local-check p95 exceeded regression ceiling: ${times[28]}ms`,
      );
      console.info(
        `writing warm p95 ${times[28].toFixed(2)}ms for a 6,000-unit window`,
      );
    },
  );
});

test("long-form eligibility is metadata-only and global Off wins site restrictions", async () => {
  const core = await import(modulePath).catch(() => ({}));
  assert.equal(
    typeof core.eligibleEditor,
    "function",
    "eligibility must be checked before reading field content",
  );
  const multiline = { tag: "textarea", visible: true, rows: 7 };
  assert.equal(core.eligibleEditor(multiline), true);
  assert.equal(
    core.eligibleEditor({
      tag: "div",
      visible: true,
      editable: true,
      multiline: true,
    }),
    true,
  );
  for (const change of [
    { tag: "input", type: "text" },
    { tag: "input", type: "password" },
    { tag: "input", type: "search" },
    { autocomplete: "username" },
    { autocomplete: "section-login current-password" },
    { autocomplete: "one-time-code" },
    { autocomplete: "cc-number" },
    { label: "Username" },
    { label: "Verification code" },
    { label: "Name" },
    { label: "Address" },
    { label: "Subject" },
    { label: "Search notes" },
    { name: "user_name" },
    { name: "email" },
    { disabled: true },
    { readonly: true },
    { visible: false },
    { spellcheck: false },
    { code: true },
    { rows: 1 },
    { multiline: false },
    { inert: true },
  ])
    assert.equal(
      core.eligibleEditor({ ...multiline, ...change }),
      false,
      JSON.stringify(change),
    );
  assert.equal(
    core.eligibleEditor({ tag: "div", editable: true, visible: true }),
    false,
  );
  const settings = core.writingSettingsSchema.parse({
    spelling: false,
    rules: { brackets: false },
  });
  const effective = core.effectiveWritingSettings(
    settings,
    { spelling: true, rules: { brackets: true } },
    true,
  );
  assert.equal(effective.spelling, false);
  assert.equal(effective.rules.brackets, false);
  assert.equal(
    core.effectiveWritingSettings(settings, {}, false).enabled,
    false,
  );
  assert.equal(core.writingSettingsSchema.parse({}).language, "en");
});

test("website writing senders need the exact extension, native top-level tab and ordinary origin", async () => {
  const path = new URL(
    "../../packages/browser-extension/src/webextension.ts",
    import.meta.url,
  ).href;
  const host = await import(path);
  assert.equal(typeof host.writingSenderOrigin, "function");
  const sender = {
    id: "fixture",
    url: "https://example.com/private?token=never-persist",
    frameId: 0,
    tab: { id: 1, windowId: 2, incognito: false },
  };
  assert.equal(
    host.writingSenderOrigin(sender, "fixture"),
    "https://example.com",
  );
  for (const change of [
    { id: "other" },
    { frameId: 1 },
    { tab: { ...sender.tab, incognito: true } },
    { tab: undefined },
    { url: "file:///private" },
    { url: "chrome-extension://fixture/panel.html" },
    { url: "https://name:secret@example.com" },
  ])
    assert.equal(
      host.writingSenderOrigin({ ...sender, ...change }, "fixture"),
      null,
    );
});

test("writing preferences merge independent changes and isolate account/language state", async () => {
  const values = new Map<string, unknown>();
  const store = new WritingPreferencesStore(
    {
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    },
    "https://api.example.com",
  );
  const first = "00000000-0000-4000-a000-000000000001",
    other = "00000000-0000-4000-a000-000000000002";
  await store.configure(first, {
    patch: { spelling: false, rules: { brackets: false } },
    addWord: "Grove",
  });
  await store.configure(first, {
    patch: { grammar: false, rules: { quotes: false } },
    addWord: "Axolotl",
  });
  const state = await store.read(first);
  assert.equal(state.settings.spelling, false);
  assert.equal(state.settings.rules.brackets, false);
  assert.equal(state.settings.rules.quotes, false);
  assert.deepEqual(state.settings.words, ["Grove", "Axolotl"]);
  assert.equal((await store.read(other)).settings.words.length, 0);
  assert.equal((await store.read(other)).settings.spelling, true);
  assert.ok([...values.keys()].every((key) => key.endsWith(":en")));
  await store.configure(first, {
    site: {
      origin: "https://example.com",
      enabled: true,
      restrictions: { rules: { brackets: false } },
    },
  });
  await store.configure(first, {
    site: {
      origin: "https://example.com",
      enabled: true,
      restrictions: { rules: { quotes: false } },
    },
  });
  const site = (await store.read(first)).sites[0];
  assert.equal(
    site.restrictions.rules?.brackets,
    false,
    "a rule change must not erase another site rule choice",
  );
  assert.equal(site.restrictions.rules?.quotes, false);
  for (const input of [
    { addWord: "private paragraph with spaces" },
    { site: { origin: "https://example.com/private", enabled: true } },
    { patch: { rawText: "never persist text" } },
    { accountId: other },
  ])
    await assert.rejects(() => store.configure(first, input));
  assert.ok(!JSON.stringify([...values]).includes("never persist text"));
});
