import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical held continuation stays manual and production-scoped, outside ordinary releases", () => {
  for (const file of ["held-release.yml", "held-release-operator.yml"]) {
    const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^ {2}(push|pull_request|workflow_run):/m);
    assert.match(workflow, /github.ref == 'refs\/heads\/production'/);
    assert.match(workflow, /github.ref_protected == true/);
    assert.match(workflow, /github.actor == 'miniaxolotl'/);
    assert.match(workflow, /environment: production/);
    assert.match(
      workflow,
      /group: production-release\n\s+cancel-in-progress: false/,
    );
    assert.doesNotMatch(workflow, /node scripts\/publish\.mjs|push: true/);
  }
});

test("ordinary release preparation and delivery never select held publication", () => {
  for (const file of ["release.yml", "deploy.yml"]) {
    const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
    assert.doesNotMatch(
      workflow,
      /held-decision|held-production|held-phase|GROVE_HELD|outputs\.held/,
    );
  }
});
