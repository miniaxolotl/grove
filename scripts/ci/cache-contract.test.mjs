import assert from "node:assert/strict";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";
test("browser caches retain toolchain keys and never publish from PR code", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const website = workflow
    .split("\n  website:\n")[1]
    .split(/\n {2}[a-z][a-z-]*:\n/)[0];
  assert.match(website, /~\/.cache\/ms-playwright/);
  assert.match(website, /\.next\/cache/);
  assert.match(
    website,
    /browser-\$\{\{ runner.os \}\}-\$\{\{ runner.arch \}\}-node24-/,
  );
  assert.match(website, /hashFiles\('(package-lock.json|pnpm-lock.yaml)'\)/);
  assert.match(
    website,
    /github.event_name != 'pull_request' && github.ref_protected/,
  );
  assert.match(
    website,
    /actions\/cache\/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/,
  );
  assert.match(
    website,
    /actions\/cache\/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/,
  );
});
