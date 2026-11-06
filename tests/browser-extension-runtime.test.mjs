/* global URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, performance, console, structuredClone */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";

test("packaged background rejects outside senders, fences accounts and avoids read/write feedback loops", async () => {
  const events = {},
    areas = { session: new Map(), local: new Map() };
  let writes = 0;
  const menus = new Map();
  let badge = "",
    title = "",
    opens = 0;
  const event = (name) => ({
    addListener(fn) {
      events[name] = fn;
    },
  });
  const area = (name) => ({
    async get(key) {
      return key === null
        ? Object.fromEntries(areas[name])
        : { [key]: areas[name].get(key) };
    },
    async set(values) {
      writes++;
      for (const [key, value] of Object.entries(values))
        areas[name].set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys)
        areas[name].delete(key);
    },
    async clear() {
      areas[name].clear();
    },
    async setAccessLevel() {},
  });
  const host = {
    storage: {
      session: area("session"),
      local: area("local"),
      onChanged: event("storage"),
    },
    runtime: {
      id: "fixture",
      getURL: (path) => `chrome-extension://fixture/${path}`,
      onMessage: event("message"),
      onInstalled: event("installed"),
      onStartup: event("startup"),
    },
    identity: { getRedirectURL: () => "https://fixture.chromiumapp.org/" },
    action: {
      onClicked: event("action"),
      async setBadgeText(value) {
        badge = value.text;
      },
      async setTitle(value) {
        title = value.title;
      },
      async setBadgeBackgroundColor() {},
    },
    contextMenus: {
      onClicked: event("menu"),
      async removeAll() {
        menus.clear();
      },
      create(value) {
        menus.set(value.id, value);
      },
    },
    windows: { onRemoved: event("removed") },
    tabs: {
      async query() {
        return [];
      },
    },
    sidePanel: {
      async open() {
        opens++;
      },
    },
  };
  const context = createContext(
    {
      chrome: host,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      crypto: webcrypto,
      AbortSignal,
      performance,
      console,
      fetch() {
        throw new Error("Unexpected network");
      },
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  runInContext(
    await readFile(
      new URL(
        "../packages/browser-extension/dist/chrome/background.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  const sender = {
    id: "fixture",
    url: "chrome-extension://fixture/panel.html",
  };
  assert.equal(
    events.message(
      { kind: "state", windowId: 1 },
      { id: "other", url: sender.url },
      () => assert.fail("outside response"),
    ),
    false,
  );
  assert.equal(
    events.message(
      { kind: "state", windowId: 1 },
      { id: "fixture", url: "https://example.com" },
      () => assert.fail("web response"),
    ),
    false,
  );
  const send = (message) =>
    new Promise((resolve) => {
      assert.equal(events.message(message, sender, resolve), true);
    });
  const writingDefaults = await send({ kind: "writingState", windowId: 1 });
  assert.equal(
    writingDefaults.ok,
    true,
    "local writing controls do not require sign-in",
  );
  assert.equal(writingDefaults.data.settings.enabled, true);
  const bad = await send({
    kind: "edit",
    windowId: 1,
    payload: { text: "outside" },
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /Account changed/);
  const initial = await send({ kind: "inbox", windowId: 1 });
  assert.equal(initial.ok, true);
  const before = writes;
  await send({ kind: "inbox", windowId: 1 });
  assert.equal(
    writes,
    before,
    "reading an unchanged inbox must not publish another storage change",
  );
  events.menu(
    {
      menuItemId: "grove-capture-selection",
      selectionText: "private",
      pageUrl: "https://example.com",
    },
    { windowId: 1, incognito: true },
  );
  assert.equal(areas.session.get("inbox:1"), undefined);
  const preferences = await send({ kind: "preferences", windowId: 1 });
  assert.equal(preferences.ok, true);
  assert.equal(preferences.data.enabled, true);
  const accountId = "00000000-0000-4000-a000-000000000001",
    connectionId = "00000000-0000-4000-a000-000000000002";
  areas.session.set("identity", { accountId, connectionId });
  areas.session.set("draft:1", { text: "Kept private draft" });
  areas.local.set("pending", [{ operationId: "opaque-recovery" }]);
  const disabled = await send({
    kind: "configure",
    windowId: 1,
    payload: { enabled: false },
  });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.enabled, false);
  assert.equal(areas.local.get("preferences").enabled, false);
  assert.equal(menus.size, 0);
  assert.equal(badge, "OFF");
  assert.match(title, /off/i);
  for (const kind of [
    "state",
    "login",
    "search",
    "save",
    "attach",
    "followSource",
    "context",
    "inbox",
    "reconcile",
  ]) {
    const blocked = await send({ kind, windowId: 1, accountId, connectionId });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error.message, /turned off/i);
  }
  events.menu(
    {
      menuItemId: "grove-capture-selection",
      selectionText: "Must not capture",
      pageUrl: "https://example.com",
    },
    { windowId: 1, incognito: false },
  );
  await send({ kind: "preferences", windowId: 1 });
  assert.equal(areas.session.get("inbox:1"), undefined);
  assert.equal(areas.session.get("draft:1").text, "Kept private draft");
  assert.equal(areas.local.get("pending")[0].operationId, "opaque-recovery");
  const beforeOpen = opens;
  events.action({ windowId: 1, incognito: false });
  assert.equal(
    opens,
    beforeOpen + 1,
    "toolbar can always open the on/off control",
  );
  events.startup();
  await send({ kind: "preferences", windowId: 1 });
  assert.equal(menus.size, 0, "restart retains disabled native entry points");
  const appearance = await send({
    kind: "configure",
    windowId: 1,
    payload: { theme: "dark" },
  });
  assert.equal(
    appearance.data.enabled,
    false,
    "changing appearance never re-enables Grove",
  );
  const enabled = await send({
    kind: "configure",
    windowId: 1,
    payload: { enabled: true, theme: "dark" },
  });
  assert.equal(enabled.ok, true);
  assert.equal(enabled.data.theme, "dark");
  assert.equal(menus.size, 3);
  assert.equal(badge, "");
  assert.equal(
    (
      await send({
        kind: "configure",
        windowId: 1,
        payload: { theme: "untrusted" },
      })
    ).ok,
    false,
  );
});
