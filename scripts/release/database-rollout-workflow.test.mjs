import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("protected exact-source migrations precede publication with owner credentials scoped to one step", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(
    workflow,
    /\n {2}migrate:\n/,
    "Missing automatic migration stage",
  );
  const migrate = workflow
    .split("\n  migrate:\n")[1]
    .split("\n  publish:\n")[0];
  const publish = workflow.split("\n  publish:\n")[1].split("\n  deploy:\n")[0];
  assert.match(migrate, /needs: candidate/);
  assert.match(migrate, /environment: production/);
  assert.match(migrate, /ref: \$\{\{ needs.candidate.outputs.sha \}\}/);
  assert.match(migrate, /persist-credentials: false/);
  assert.match(
    migrate,
    /run: node --import tsx scripts\/release\/database-rollout.mjs/,
  );
  assert.match(
    migrate,
    /GROVE_MIGRATION_DATABASE_URL: \$\{\{ secrets.GROVE_MIGRATION_DATABASE_URL \}\}/,
  );
  assert.doesNotMatch(migrate, /SAFETY_RECEIPT|backup|restore/i);
  assert.match(
    migrate,
    /run: node --import tsx scripts\/release\/database-preflight.mjs/,
  );
  assert.match(publish, /needs: \[candidate, migrate\]/);
  assert.equal(
    (workflow.match(/secrets.GROVE_MIGRATION_DATABASE_URL/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    migrate,
    /continue-on-error|if: always|migrate:rollback|forceFreeMigrationsLock/,
  );
  const ownerStep = migrate
    .split("      - name: Apply reviewed forward migrations\n")[1]
    ?.split("      - ")[0];
  assert.ok(
    ownerStep?.includes("secrets.GROVE_MIGRATION_DATABASE_URL"),
    "Owner URL must not be job-scoped",
  );
});
