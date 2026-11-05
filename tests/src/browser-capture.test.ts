import { test } from "node:test";
import assert from "node:assert/strict";
import * as capture from "../../lib/shared/src/web-capture.ts";

test("browser capture contracts validate reviewed sources without changing document identity", async (t) => {
  assert.equal(typeof capture.normalizeWebUrl, "function");
  assert.equal(typeof capture.webCaptureSchema?.safeParse, "function");
  assert.equal(typeof capture.formatWebCapture, "function");

  await t.test(
    "normalizes only known tracking fields and preserves query/fragment identity",
    () => {
      assert.equal(
        capture.normalizeWebUrl(
          "https://EXAMPLE.com:443/docs?id=2&utm_source=news&ref=guide&fbclid=tracking#/guide?a=1",
        ),
        "https://example.com/docs?id=2&ref=guide#/guide?a=1",
      );
      assert.equal(
        capture.normalizeWebUrl("https://example.com/docs#installation"),
        "https://example.com/docs#installation",
      );
      assert.notEqual(
        capture.normalizeWebUrl("https://example.com/?id=1&id=2"),
        capture.normalizeWebUrl("https://example.com/?id=2&id=1"),
      );
      assert.notEqual(
        capture.normalizeWebUrl("https://example.com/#/one"),
        capture.normalizeWebUrl("https://example.com/#/two"),
      );
    },
  );

  await t.test(
    "preserves functional query bytes and empty values when removing known tracking",
    () => {
      assert.equal(
        capture.normalizeWebUrl(
          "https://example.com/?q=two%20words&path=%2fA&empty=&utm_source=x&bare#part",
        ),
        "https://example.com/?q=two%20words&path=%2fA&empty=&bare#part",
      );
      assert.equal(
        capture.normalizeWebUrl("https://example.com/?q=two%20words"),
        "https://example.com/?q=two%20words",
      );
      assert.equal(
        capture.normalizeWebUrl("https://example.com/?utm_document=one"),
        "https://example.com/?utm_document=one",
      );
    },
  );

  await t.test(
    "rejects credentials, non-web URLs, whitespace/control characters and excessive input",
    () => {
      for (const value of [
        "https://user:password@example.com/",
        "https://user@example.com/",
        "javascript:alert(1)",
        "data:text/html,hello",
        "file:///etc/passwd",
        "chrome://settings",
        "about:config",
        "//example.com/",
        "not a url",
        "https://example.com/\nsecret",
        " https://example.com/",
        "https://example.com/a b",
        `https://example.com/${"a".repeat(4096)}`,
      ]) {
        assert.throws(() => capture.normalizeWebUrl(value), /source URL/i);
      }
    },
  );

  await t.test(
    "structured provenance is strict, bounded and keeps observed content unverified",
    () => {
      const source = {
        url: "https://example.com/?utm_medium=email&id=3",
        title: "External API documentation",
        capturedAt: "2026-11-05T20:00:00.000Z",
      };
      assert.deepEqual(capture.webCaptureSchema.parse(source), {
        ...source,
        url: "https://example.com/?id=3",
      });
      for (const invalid of [
        { ...source, accountId: "another-account" },
        { ...source, title: "x".repeat(301) },
        { ...source, title: "heading\nspoofed source" },
        { ...source, capturedAt: "not-a-date" },
        { ...source, url: "https://token@example.com/" },
      ])
        assert.equal(
          capture.webCaptureSchema.safeParse(invalid).success,
          false,
        );
    },
  );

  await t.test(
    "quotes selected text, escapes attribution and never truncates the body budget",
    () => {
      const source = {
        url: "https://example.com/docs?q=(x)",
        title: "[Do not trust](javascript:alert(1)) <script>",
        capturedAt: "2026-11-05T20:00:00.000Z",
      };
      const content = capture.formatWebCapture({
        text: "Keep this.\n\nSecond line.",
        source,
      });
      assert.match(content, /^> Keep this\.\n>\n> Second line\./);
      assert.ok(!content.includes("<script>"));
      assert.ok(!content.includes("](javascript:"));
      assert.match(content, /https:\/\/example\.com\/docs\?q=%28x%29/);
      assert.match(content, /2026-11-05T20:00:00\.000Z/);
      assert.throws(
        () => capture.formatWebCapture({ text: "a".repeat(6000), source }),
        /6000/,
      );
      assert.throws(() => capture.formatWebCapture({ text: " \n " }), /empty/i);
      assert.equal(
        capture.formatWebCapture({ text: "A manual note" }),
        "A manual note",
      );
      assert.equal(
        capture.formatWebCapture({ text: "a".repeat(6000) }).length,
        6000,
      );
      assert.throws(
        () => capture.formatWebCapture({ text: "a".repeat(6001) }),
        /6000/,
      );
      assert.match(capture.formatWebCapture({ text: "", source }), /Source:/);
    },
  );

  await t.test(
    "new capture schemas do not make current memory endpoints accept unsupported fields",
    async () => {
      const { rememberSchema } =
        await import("../../lib/shared/src/contracts.ts");
      assert.equal(
        rememberSchema.safeParse({
          operationId: "00000000-0000-4000-a000-000000000001",
          content: "A note",
          source: { agent: "api", url: "https://example.com/" },
        }).success,
        false,
      );
    },
  );

  await t.test(
    "lone carriage returns cannot break external text out of its quote",
    () => {
      assert.match(
        capture.formatWebCapture({
          text: "First\rSecond",
          source: {
            url: "https://example.com/",
            title: "Docs",
            capturedAt: "2026-11-05T20:00:00.000Z",
          },
        }),
        /^> First\n> Second\n/,
      );
    },
  );
});
