import { test } from "node:test";
import assert from "node:assert/strict";
import { userMessage } from "../../packages/browser-extension/src/messages.ts";

test("extension user messages never surface server details", async (t) => {
  await t.test("maps known codes to safe copy", () => {
    assert.equal(
      userMessage({ code: "sharing_permission_required" }, "fallback"),
      "Allow sharing links in Grove first.",
    );
    assert.equal(
      userMessage({ code: "unauthorized" }, "fallback"),
      "Sign in again to continue.",
    );
    assert.equal(
      userMessage({ code: "connection_revoked" }, "fallback"),
      "Sign in again to continue.",
    );
    assert.equal(
      userMessage({ code: "connection_required" }, "fallback"),
      "Sign in again to continue.",
    );
    assert.equal(
      userMessage({ code: "forbidden" }, "fallback"),
      "Check your note access in Grove.",
    );
    assert.equal(
      userMessage({ code: "version_conflict" }, "fallback"),
      "This note changed. Reopen it to continue.",
    );
    assert.equal(
      userMessage({ code: "operation_conflict" }, "fallback"),
      "This note changed. Reopen it to continue.",
    );
    assert.equal(
      userMessage({ code: "sharing_unavailable" }, "fallback"),
      "Sharing isn’t available right now.",
    );
    assert.equal(
      userMessage({ code: "rate_limited" }, "fallback"),
      "Please wait a moment and try again.",
    );
  });

  await t.test("falls back without leaking error internals", () => {
    assert.equal(
      userMessage({ code: "unknown_xyz" }, "Try again."),
      "Try again.",
    );
    assert.equal(userMessage(null), "Couldn’t finish. Try again.");
    assert.equal(
      userMessage(new Error("s3: bucket exploded stack: ...")),
      "Couldn’t finish. Try again.",
    );
    assert.equal(
      userMessage({ code: "sharing_permission_required" }),
      "Allow sharing links in Grove first.",
    );
  });
});
