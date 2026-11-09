import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyText,
  copyWritingChoice,
} from "../../packages/browser-extension/src/writing/clipboard.ts";

function withClipboard(clipboard: unknown) {
  const previous = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, "navigator", {
    value: clipboard ? { clipboard } : {},
    configurable: true,
  });
  return () =>
    Object.defineProperty(globalThis, "navigator", {
      value: previous,
      configurable: true,
    });
}

test("shared clipboard helper never throws and reports success", async (t) => {
  await t.test("resolves true on successful copy", async () => {
    const restore = withClipboard({ writeText: async () => {} });
    try {
      assert.equal(await copyText("hello"), true);
    } finally {
      restore();
    }
  });

  await t.test(
    "resolves false when clipboard is missing or rejects",
    async () => {
      const restoreMissing = withClipboard(null);
      try {
        assert.equal(await copyText("hello"), false);
      } finally {
        restoreMissing();
      }
      const restoreReject = withClipboard({
        writeText: async () => {
          throw new Error("denied");
        },
      });
      try {
        assert.equal(await copyText("hello"), false);
      } finally {
        restoreReject();
      }
    },
  );

  await t.test(
    "writing feedback distinguishes replaced text from copies",
    async () => {
      const restore = withClipboard({ writeText: async () => {} });
      try {
        const messages: string[] = [];
        copyWritingChoice("alt", (message) => messages.push(message));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(messages, ["Copied and replaced"]);
      } finally {
        restore();
      }
      const restoreFail = withClipboard({
        writeText: async () => {
          throw new Error("denied");
        },
      });
      try {
        const messages: string[] = [];
        copyWritingChoice("alt", (message) => messages.push(message));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(messages, ["Text replaced. Clipboard unavailable."]);
      } finally {
        restoreFail();
      }
    },
  );
});
