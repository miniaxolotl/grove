import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createControl, sha } from "./operator-control.mjs";
const api = await import("./installation.mjs");
test("each installation key refresh rejects a mutable replacement against the retained independent pin", async () => {
  assert.equal(typeof api.readPinnedReviewKey, "function");
  const root = await mkdtemp(process.cwd() + "/.review-key-");
  try {
    const c = createControl(root),
      pin = { reviewKeySha256: sha("review-key-one") };
    await writeFile(root + "/review-key.pem", "review-key-one", {
      mode: 0o600,
    });
    assert.equal(await api.readPinnedReviewKey(c, pin), "review-key-one");
    await writeFile(root + "/review-key.pem", "untrusted-replacement");
    await assert.rejects(api.readPinnedReviewKey(c, pin), /REVIEW_AUTHORITY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
