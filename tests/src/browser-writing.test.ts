import { test } from "node:test";
import assert from "node:assert/strict";
import { WritingPreferencesStore } from "../../packages/browser-extension/src/writing/preferences.ts";

const modulePath = new URL(
  "../../packages/browser-extension/src/writing/core.ts",
  import.meta.url,
).href;

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

test("writing controls are browser-wide while personal words remain account/language scoped", async () => {
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
  await store.configure(first, { addWord: "D’Arvél" });
  const duplicate = await store.configure(first, { addWord: "d'arve\u0301l" });
  assert.deepEqual(duplicate.settings.words, ["Grove", "Axolotl", "D’Arvél"]);
  const removed = await store.configure(first, { removeWord: "D'ARVÉL" });
  assert.deepEqual(removed.settings.words, ["Grove", "Axolotl"]);
  assert.equal((await store.read(other)).settings.words.length, 0);
  assert.equal((await store.read(other)).settings.spelling, false);
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

test("website checks default on and domain exceptions include descendants without affecting siblings or suffix lookalikes", async () => {
  const path = new URL(
    "../../packages/browser-extension/src/writing/preferences.ts",
    import.meta.url,
  ).href;
  const { writingSettingsFor } = await import(path);
  assert.equal(typeof writingSettingsFor, "function");
  const values = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  const store = new WritingPreferencesStore(storage, "https://api.example.com");
  assert.equal(
    writingSettingsFor(await store.read(), "https://unseen.example").enabled,
    true,
  );
  await store.configure(undefined, {
    site: { domain: "Example.COM.", enabled: false },
  });
  for (const origin of [
    "https://example.com",
    "http://docs.example.com:8080",
    "https://deep.docs.example.com.",
  ])
    assert.equal(writingSettingsFor(await store.read(), origin).enabled, false);
  for (const origin of [
    "https://notexample.com",
    "https://example.com.evil.test",
    "https://example.org",
  ])
    assert.equal(writingSettingsFor(await store.read(), origin).enabled, true);
  await store.configure(undefined, {
    site: { domain: "docs.example.com", enabled: true },
  });
  assert.equal(
    writingSettingsFor(await store.read(), "https://docs.example.com").enabled,
    false,
    "a child cannot override a blocked parent",
  );
  await store.configure(undefined, { removeDomain: "example.com" });
  assert.equal(
    writingSettingsFor(await store.read(), "https://docs.example.com").enabled,
    true,
  );
  await store.configure(undefined, { patch: { enabled: false } });
  assert.equal(
    writingSettingsFor(await store.read(), "https://unseen.example").enabled,
    false,
  );
  const reopened = new WritingPreferencesStore(
    storage,
    "https://other-api.example",
  );
  assert.equal(
    (await reopened.read()).settings.enabled,
    false,
    "sign-out, API/account changes and restart do not undo browser-wide Off",
  );
  for (const domain of [
    "*.example.com",
    "https://example.com",
    "example.com/path",
    "example.com:8080",
    "a@example.com",
  ])
    await assert.rejects(() =>
      store.configure(undefined, { site: { domain, enabled: false } }),
    );
});

test("upgrade preserves every existing opt-out without sharing personal words between accounts", async () => {
  const first = "00000000-0000-4000-a000-000000000001",
    other = "00000000-0000-4000-a000-000000000002";
  const core = await import(modulePath);
  const values = new Map<string, unknown>([
    [
      `writing:https://api.example.com:${first}:en`,
      {
        version: 2,
        settings: core.writingSettingsSchema.parse({
          spelling: false,
          words: ["Axolotl"],
        }),
        sites: [
          { origin: "https://example.com", enabled: false, restrictions: {} },
        ],
      },
    ],
    [
      `writing:https://api.example.com:${other}:en`,
      {
        version: 1,
        settings: core.writingSettingsSchema.parse({
          rules: { quotes: false },
          words: ["Grove"],
        }),
        sites: [],
      },
    ],
  ]);
  const storage = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  const store = new WritingPreferencesStore(
    storage,
    "https://api.example.com",
    async () => Object.fromEntries(values),
  );
  const signedOut = await store.read();
  assert.equal(signedOut.settings.spelling, false);
  assert.equal(signedOut.settings.rules.quotes, false);
  assert.deepEqual(signedOut.settings.words, []);
  assert.deepEqual((await store.read(first)).settings.words, ["Axolotl"]);
  assert.deepEqual((await store.read(other)).settings.words, ["Grove"]);
  assert.equal(
    signedOut.sites.find(
      (site: { domain: string }) => site.domain === "example.com",
    )?.enabled,
    false,
  );
  assert.equal(
    JSON.stringify(values.get("writing-browser:en")).includes("Axolotl"),
    false,
  );
});
