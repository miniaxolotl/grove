import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { parseHeldDecision } from "./held-delivery.mjs";
import { resolveHeldWorkflowSelection } from "./held-workflow-source.mjs";
const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const job = (name) =>
  workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
const expression = (name) => {
  const b = job(name),
    multi = b.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m);
  return (multi ? multi[1] : b.match(/^ {4}if: (.*)$/m)?.[1])
    ?.trim()
    .replaceAll(/needs\.([\w-]+)/g, 'needs["$1"]');
};
test("held publication cannot accidentally execute ordinary deployment or website jobs", () => {
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
});
test("only a source-bound declaration or coordinated stamp selects the held workflow matrix", () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const selection = resolveHeldWorkflowSelection(source);
  const path = "scripts/release/held-decision.json";
  assert.deepEqual(
    selection?.manifest ?? null,
    parseHeldDecision(existsSync(path) ? readFileSync(path, "utf8") : null),
    "Working declaration must match validated Git source",
  );
  const held = selection !== null;
  const needs = {
    candidate: {
      result: "success",
      outputs: { mode: "coordinated", held: held ? "true" : "" },
    },
    publish: { result: "success" },
    deploy: { result: "success" },
    "website-scope": { result: "skipped" },
  };
  const evaluate = (value) =>
    runInNewContext(
      value.trim().replaceAll(/needs\.([\w-]+)/g, 'needs["$1"]'),
      { needs, cancelled: () => false },
      { timeout: 100 },
    );
  for (const name of ["deploy", "website"])
    assert.equal(
      evaluate(expression(name)),
      !held,
      `${name}: actual source-held selection`,
    );
  const step = (name) =>
    workflow.split(`      - name: ${name}\n`)[1].split(/\n {6}- /)[0];
  assert.equal(
    evaluate(
      step("Persist pending held publication before irreversible writes").match(
        /^ {8}if: (.*)$/m,
      )[1],
    ),
    held,
  );
  assert.equal(
    evaluate(
      step("Validate the admitted topology before npm publication").match(
        /^ {8}if: (.*)$/m,
      )[1],
    ),
    !held,
    "Held publication must never call the provider proposal POST",
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
