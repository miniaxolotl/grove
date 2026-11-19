import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
test("held publication cannot accidentally execute ordinary deployment or website jobs", () => {
  const job = (name) =>
    workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
  const expression = (name) => {
    const b = job(name),
      multi = b.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m);
    return (multi ? multi[1] : b.match(/^ {4}if: (.*)$/m)?.[1])
      ?.trim()
      .replaceAll(/needs\.([\w-]+)/g, 'needs["$1"]');
  };
  const needs = {
    candidate: {
      result: "success",
      outputs: { mode: "coordinated", held: "true" },
    },
    publish: { result: "success" },
    deploy: { result: "success" },
    "website-scope": { result: "skipped" },
  };
  for (const name of ["deploy", "website"]) {
    const exp = expression(name);
    assert(exp, `${name} needs an explicit hold condition`);
    assert.equal(
      runInNewContext(exp, { needs, cancelled: () => false }),
      false,
      name,
    );
  }
  assert.equal(
    existsSync("scripts/release/held-decision.json"),
    false,
    "No source release is activated by this patch",
  );
});
test("held builds and durable pending/publication receipts precede any effect release", () => {
  assert.match(
    workflow,
    /GROVE_HELD_RELEASE_BUILD=\$\{\{ needs\.candidate\.outputs\.held/,
  );
  const pending = workflow.indexOf("held-production.mjs pending");
  assert(pending > 0);
  const uploaded = workflow.indexOf("name: held-pending-");
  assert(uploaded > pending);
  assert(
    uploaded < workflow.indexOf("id: build"),
    "Pending receipt must survive an image-write crash",
  );
  assert.match(workflow, /held-production\.mjs complete/);
  assert.match(workflow, /name: held-publication-/);
  assert.match(
    readFileSync("scripts/release/proofing-release.mjs", "utf8"),
    /resolveHeldDecision/,
  );
});
test("publication-only held runs never invoke the legacy provider proposal POST", () => {
  const step = workflow
    .split(
      "      - name: Validate the admitted topology before npm publication\n",
    )[1]
    .split("      - name: Publish all coordinated npm artifacts")[0];
  assert.match(step, /if: needs\.candidate\.outputs\.held != 'true'/);
});
