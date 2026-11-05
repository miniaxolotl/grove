import { test } from "node:test";
import assert from "node:assert/strict";
import * as platform from "../../packages/browser-extension/src/platform.ts";

test("browser platform core uses explicit native adapters and user-triggered capture snapshots", async (t) => {
  assert.equal(typeof platform.browserProfile, "function");
  assert.equal(typeof platform.openNativePanel, "function");
  assert.equal(typeof platform.contextMenuCapture, "function");

  await t.test(
    "browser profiles distinguish Gecko from both Chromium targets",
    () => {
      assert.deepEqual(platform.browserTargets, ["chrome", "firefox", "edge"]);
      assert.equal(platform.browserProfile("chrome").panelApi, "sidePanel");
      assert.equal(
        platform.browserProfile("edge").panelManifestKey,
        "side_panel",
      );
      assert.equal(
        platform.browserProfile("chrome").background,
        "service_worker",
      );
      assert.equal(
        platform.browserProfile("firefox").panelApi,
        "sidebarAction",
      );
      assert.equal(
        platform.browserProfile("firefox").panelManifestKey,
        "sidebar_action",
      );
      assert.equal(platform.browserProfile("firefox").background, "event_page");
      assert.throws(
        () => platform.browserProfile("safari" as platform.BrowserTarget),
        /unsupported/i,
      );
    },
  );

  await t.test(
    "native panel calls occur synchronously within the caller's user gesture",
    async () => {
      for (const target of platform.browserTargets) {
        const calls: unknown[] = [];
        const chromium = {
          open(options: { windowId: number }) {
            calls.push(options);
            assert.equal(this, chromium);
            return Promise.resolve();
          },
        };
        const gecko = {
          open() {
            calls.push("firefox");
            assert.equal(this, gecko);
            return Promise.resolve();
          },
        };
        const pending = platform.openNativePanel(
          target,
          { sidePanel: chromium, sidebarAction: gecko },
          7,
        );
        assert.deepEqual(
          calls,
          target === "firefox" ? ["firefox"] : [{ windowId: 7 }],
        );
        await pending;
      }
      assert.throws(
        () => platform.openNativePanel("chrome", {}, 7),
        /unavailable/i,
      );
      assert.throws(
        () => platform.openNativePanel("firefox", {}, 7),
        /unavailable/i,
      );
      assert.throws(
        () =>
          platform.openNativePanel(
            "edge",
            { sidePanel: { open: async () => {} } },
            -1,
          ),
        /window/i,
      );
      const denied = new Error("User gesture required");
      await assert.rejects(
        platform.openNativePanel(
          "chrome",
          { sidePanel: { open: () => Promise.reject(denied) } },
          7,
        ),
        denied,
      );
    },
  );

  await t.test(
    "selection capture uses the event URL, not a later tab destination",
    () => {
      const draft = platform.contextMenuCapture(
        {
          menuItemId: "grove-capture-selection",
          selectionText: "Verbatim selected words",
          pageUrl: "https://example.com/original?utm_source=x",
        },
        {
          url: "https://example.com/new-page",
          title: "Do not attribute this title",
          incognito: false,
        },
        0,
      );
      assert.deepEqual(draft, {
        text: "Verbatim selected words",
        source: {
          url: "https://example.com/original",
          title: "",
          capturedAt: "1970-01-01T00:00:00.000Z",
        },
      });
    },
  );

  await t.test(
    "link capture never claims the containing page title describes the link target",
    () => {
      const draft = platform.contextMenuCapture(
        {
          menuItemId: "grove-capture-link",
          linkUrl: "https://target.example/docs",
          pageUrl: "https://example.com/",
        },
        {
          title: "Containing page",
          url: "https://example.com/",
          incognito: false,
        },
        0,
      );
      assert.equal(draft?.text, "");
      assert.equal(draft?.source.title, "");
      assert.equal(draft?.source.url, "https://target.example/docs");
      assert.equal(
        platform.contextMenuCapture(
          { menuItemId: "other-menu" },
          { incognito: false },
          0,
        ),
        null,
      );
    },
  );

  await t.test(
    "frame selections keep the frame's source without claiming the parent title",
    () => {
      const capture = platform.contextMenuCapture(
        {
          menuItemId: "grove-capture-selection",
          selectionText: "From the frame",
          frameUrl: "https://frame.example/docs",
          pageUrl: "https://parent.example/",
        },
        {
          incognito: false,
          url: "https://parent.example/",
          title: "Parent page",
        },
        0,
      );
      assert.equal(capture?.source.url, "https://frame.example/docs");
      assert.equal(capture?.source.title, "");
    },
  );

  await t.test(
    "private browsing, unsafe URLs and oversized selections fail closed",
    () => {
      const event = {
        menuItemId: "grove-capture-selection",
        selectionText: "A quote",
        pageUrl: "https://example.com/",
      };
      assert.throws(
        () => platform.contextMenuCapture(event, { incognito: true }, 0),
        /private/i,
      );
      assert.throws(
        () => platform.contextMenuCapture(event, {}, 0),
        /private/i,
      );
      assert.throws(
        () =>
          platform.contextMenuCapture(
            { ...event, selectionText: "x".repeat(6001) },
            { incognito: false },
            0,
          ),
        /selection/i,
      );
      assert.throws(
        () =>
          platform.contextMenuCapture(
            { ...event, selectionText: "" },
            { incognito: false },
            0,
          ),
        /selection/i,
      );
      assert.throws(
        () =>
          platform.contextMenuCapture(
            { ...event, pageUrl: "file:///secret" },
            { incognito: false },
            0,
          ),
        /source URL/i,
      );
      assert.throws(() =>
        platform.contextMenuCapture(event, { incognito: false }, Number.NaN),
      );
    },
  );
});
