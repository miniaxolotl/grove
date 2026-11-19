import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("held image builds explicitly bake the non-bypassable startup latch while normal package builds stay unchanged", () => {
  const docker = readFileSync("Dockerfile", "utf8");
  const build = readFileSync("scripts/build.mjs", "utf8");
  assert.match(docker, /ARG GROVE_HELD_RELEASE_BUILD/);
  assert.match(build, /__GROVE_HELD_RELEASE_BUILD__/);
  assert.match(build, /holdRequired/);
  assert.match(build, /GROVE_HELD_RELEASE_BUILD.*true/);
});
