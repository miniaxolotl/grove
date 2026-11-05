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
    action: { onClicked: event("action") },
    contextMenus: {
      onClicked: event("menu"),
      async removeAll() {},
      create() {},
    },
    windows: { onRemoved: event("removed") },
    tabs: {
      async query() {
        return [];
      },
    },
    sidePanel: { async open() {} },
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
});
