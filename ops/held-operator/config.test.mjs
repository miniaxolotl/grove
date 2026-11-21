import assert from "node:assert/strict";
import test from "node:test";
const api = await import("./config.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("versioned installation schema rejects legacy/admission flags/unknown authority fields", () => {
  assert.equal(typeof api.validateConfig, "function");
  const config = {
    schema: 2,
    contract: "source-bound-held-release-v1",
    sourceRoot: "/fixture",
    inventory: {},
    report: "/r",
    blueprint: "/b",
    review: "/v",
    authority: null,
    window: null,
    policy: {
      appId: "app",
      parentSession: "owner",
      deployedSource: "a".repeat(40),
      deployedImage: "sha256:" + "b".repeat(64),
      originalsEncryptedSha256: "c".repeat(64),
      originalsReviewDue: "2026-12-19",
    },
  };
  api.validateConfig(config);
  for (const change of [
    { schema: 1 },
    { executionAdmitted: true },
    { authority: { reset: true } },
    { window: { qualified: true } },
    { policy: { ...config.policy, qualified: true } },
  ])
    assert.throws(
      () => api.validateConfig({ ...config, ...change }),
      /CONFIGURATION/,
    );
});
