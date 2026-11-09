import { test } from "node:test";
import assert from "node:assert/strict";
import {
  storageAdapter,
  trustedPanel,
  writingSenderOrigin,
  writingSitePattern,
} from "../../packages/browser-extension/src/webextension.ts";

test("browser host guards use sender metadata, never payload claims", async (t) => {
  await t.test("trusted panel requires exact runtime id and panel path", () => {
    const runtime = {
      id: "abc123",
      getURL: (path: string) => `chrome-extension://abc123/${path}`,
    };
    assert.equal(
      trustedPanel(
        { id: "abc123", url: "chrome-extension://abc123/panel.html" },
        runtime,
      ),
      true,
    );
    assert.equal(
      trustedPanel(
        { id: "abc123", url: "chrome-extension://abc123/panel.html?x=1" },
        runtime,
      ),
      true,
    );
    assert.equal(
      trustedPanel(
        { id: "other", url: "chrome-extension://abc123/panel.html" },
        runtime,
      ),
      false,
    );
    assert.equal(
      trustedPanel(
        { id: "abc123", url: "chrome-extension://abc123/other.html" },
        runtime,
      ),
      false,
    );
    assert.equal(trustedPanel({ id: "abc123" }, runtime), false);
  });

  await t.test(
    "writing sender origin rejects non-top, private or foreign frames",
    () => {
      const good = {
        id: "ext-id",
        frameId: 0,
        tab: { id: 3, windowId: 1, incognito: false },
        url: "https://example.com/docs",
      };
      assert.equal(writingSenderOrigin(good, "ext-id"), "https://example.com");
      for (const sender of [
        { ...good, id: "other" },
        { ...good, frameId: 1 },
        { ...good, tab: { ...good.tab, incognito: true } },
        { ...good, tab: { ...good.tab, incognito: undefined } },
        { ...good, tab: { ...good.tab, id: undefined } },
        { ...good, url: "javascript:alert(1)" },
        { ...good, url: "https://user@example.com/" },
        { ...good, url: undefined },
      ])
        assert.equal(writingSenderOrigin(sender, "ext-id"), null);
    },
  );

  await t.test(
    "site patterns are hostname-only on firefox and exact origin elsewhere",
    () => {
      assert.equal(
        writingSitePattern("https://example.com", "chrome"),
        "https://example.com/*",
      );
      assert.equal(
        writingSitePattern("https://example.com", "firefox"),
        "https://example.com/*",
      );
      assert.equal(
        writingSitePattern("http://localhost:3000", "firefox"),
        "http://localhost/*",
      );
      assert.equal(
        writingSitePattern("http://localhost:3000", "chrome"),
        "http://localhost:3000/*",
      );
      assert.throws(() => writingSitePattern("javascript:alert(1)", "chrome"));
      assert.throws(() =>
        writingSitePattern("https://example.com/path", "chrome"),
      );
    },
  );

  await t.test(
    "storage adapter round-trips through the host area",
    async () => {
      const backing = new Map<string, unknown>();
      const area = {
        async get(keys: string | null) {
          return keys == null
            ? Object.fromEntries(backing)
            : { [keys]: backing.get(keys) };
        },
        async set(values: Record<string, unknown>) {
          for (const [k, v] of Object.entries(values)) backing.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const k of Array.isArray(keys) ? keys : [keys])
            backing.delete(k);
        },
        async clear() {
          backing.clear();
        },
      };
      const store = storageAdapter(area);
      await store.set("k", { a: 1 });
      assert.deepEqual(await store.get("k"), { a: 1 });
      await store.remove("k");
      assert.equal(await store.get("k"), undefined);
    },
  );
});
