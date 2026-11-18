import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as impact from "./impact-plan.mjs";

const receipts = JSON.parse(
  readFileSync("scripts/release/impact-receipts.json"),
).targets;
test("selective Release Please retains product intent and cannot stamp installer files", () => {
  const normal = JSON.parse(readFileSync("release-please-config.json"));
  delete normal.packages["."]["extra-files"];
  assert.deepEqual(
    JSON.parse(readFileSync("release-please-website.json")),
    normal,
  );
});
function report() {
  return {
    mode: "production-advisory",
    candidate: "a".repeat(40),
    targets: Object.fromEntries(
      Object.entries(receipts).map(([name, receipt]) => [
        name,
        {
          state:
            name === "website" || name === "downloads"
              ? "selected"
              : "unchanged",
          baselineSource: receipt.source,
          oldIdentity: receipt.identity,
          evidence: receipt.evidence,
          changes:
            name === "website" || name === "downloads" ? ["changed-file"] : [],
          proposedIdentity:
            name === "website" || name === "downloads"
              ? { source: "a".repeat(40) }
              : receipt.identity,
        },
      ]),
    ),
  };
}
test("admit a changed website while explicitly holding changed browser downloads", () => {
  const r = report();
  assert.equal(typeof impact.selectWebsite, "function");
  assert.deepEqual(impact.selectWebsite(r, receipts, r.candidate), {
    deliver: ["website"],
    held: ["downloads"],
    publish: [],
  });
  for (const key of [
    "service",
    ...Object.keys(receipts).filter((k) => k.startsWith("npm:")),
  ]) {
    const bad = globalThis.structuredClone(r);
    bad.targets[key].state = "review";
    assert.throws(() => impact.selectWebsite(bad, receipts, r.candidate));
  }
  assert.throws(() => impact.selectWebsite(r, receipts, "b".repeat(40)));
  delete r.targets.downloads;
  assert.throws(() => impact.selectWebsite(r, receipts, r.candidate));
});
