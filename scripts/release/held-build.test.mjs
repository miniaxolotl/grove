import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("ordinary worker continues durable billing through the same fenced reconciler and broker", () => {
  const worker = readFileSync("packages/api/src/worker-runtime.ts", "utf8");
  assert.match(worker, /reconcileLifecycleBilling/);
  assert.match(worker, /publishLifecycleWork/);
  assert.match(worker, /ordinaryLifecycleBinding/);
});
test("publication verification is read-only and rejects missing packages rather than treating dry-run as completion", () => {
  const publisher = readFileSync("scripts/publish.mjs", "utf8");
  assert.match(publisher, /--verify-only/);
  assert.match(publisher, /verifyOnly.*!integrity|!integrity.*verifyOnly/s);
});
test("held image builds explicitly bake the non-bypassable startup latch while normal package builds stay unchanged", () => {
  const docker = readFileSync("Dockerfile", "utf8");
  const build = readFileSync("scripts/build.mjs", "utf8");
  assert.match(docker, /ARG GROVE_HELD_RELEASE_BUILD/);
  assert.match(build, /__GROVE_HELD_RELEASE_BUILD__/);
  assert.match(build, /holdRequired/);
  assert.match(build, /GROVE_HELD_RELEASE_BUILD.*true/);
});
