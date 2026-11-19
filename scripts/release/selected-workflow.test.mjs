import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
function condition(job) {
  const body = workflow.split(`\n  ${job}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
  const match = body.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m);
  assert(match, `Expected explicit skipped-dependency condition for ${job}`);
  return match[1].trim().replaceAll(/needs\.([\w-]+)/g, 'needs["$1"]');
}
const publish = condition("publish"),
  website = condition("website");
function evaluate(expression, needs, cancelled = false) {
  return runInNewContext(
    expression,
    { needs, cancelled: () => cancelled },
    { timeout: 100 },
  );
}
test("selected deploy supplies every baseline verifier credential/context", () => {
  const deploy = workflow
    .split("\n  deploy:\n")[1]
    .split("\n  website-scope:\n")[0];
  for (const [key, owner] of [
    ["VERCEL_TOKEN", "secrets"],
    ["VERCEL_ORG_ID", "vars"],
    ["VERCEL_PROJECT_ID", "vars"],
  ]) {
    assert(
      deploy.includes(`${key}: \${{ ${owner}.${key} }}`),
      `Missing ${key} for selected baseline verification`,
    );
  }
  assert.match(
    deploy,
    /RELEASE_DECISION_HASH: \$\{\{ needs\.candidate\.outputs\.decision \}\}/,
  );
  assert.match(deploy, /node scripts\/release\/selected-deploy\.mjs/);
});

test("actual workflow skip graph delivers only selected destinations and holds partial failures", () => {
  for (const [mode, service, site, scope, publishExpected, websiteExpected] of [
    ["coordinated", "", "", "skipped", true, true],
    ["website-only", "", "", "success", false, true],
    ["selected", "false", "true", "success", false, true],
    ["selected", "true", "false", "success", true, false],
    ["selected", "true", "true", "success", true, true],
    ["selected", "true", "true", "failure", false, false],
  ]) {
    const needs = {
      candidate: {
        result: "success",
        outputs: { mode, service, website: site },
      },
      "website-scope": { result: scope },
      publish: { result: publishExpected ? "success" : "skipped" },
      deploy: { result: publishExpected ? "success" : "skipped" },
    };
    assert.equal(
      evaluate(publish, needs),
      publishExpected,
      `${mode}: image publisher`,
    );
    assert.equal(evaluate(website, needs), websiteExpected, `${mode}: Vercel`);
    assert.equal(evaluate(publish, needs, true), false);
    assert.equal(evaluate(website, needs, true), false);
    if (publishExpected) {
      needs.deploy.result = "failure";
      assert.equal(
        evaluate(website, needs),
        false,
        "No website write after failed backend delivery",
      );
    }
    needs.candidate.result = "failure";
    assert.equal(evaluate(publish, needs), false);
    assert.equal(evaluate(website, needs), false);
  }
});
