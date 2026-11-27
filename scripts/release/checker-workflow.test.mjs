import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("production publishes all four images before backend deployment, without activating a checker", () => {
  const path = ".github/workflows/deploy.yml";
  assert(existsSync(path));
  const workflow = readFileSync(path, "utf8");
  assert.match(workflow, /github\.ref == 'refs\/heads\/production'/);
  assert.match(workflow, /github\.ref_protected == true/);
  assert.match(workflow, /promotion\.mjs wait-ci "\$GITHUB_SHA"/);
  assert.match(workflow, /promotion\.mjs production "\$GITHUB_SHA"/);
  assert.match(workflow, /migrate:\n\s+needs: candidate/);
  assert.match(workflow, /publish:\n\s+needs: \[candidate, migrate\]/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /ref: \$\{\{ needs\.candidate\.outputs\.sha \}\}/);
  assert.match(
    workflow,
    /RELEASE_SOURCE_SHA: \$\{\{ needs\.candidate\.outputs\.sha \}\}/,
  );
  assert.match(workflow, /container-images\.mjs preflight/);
  assert.match(workflow, /container-images\.mjs prepare/);
  assert.match(workflow, /container-images\.mjs promote/);
  assert.match(workflow, /container-images\.json/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /--languagetool-digest|LANGUAGETOOL_URL/);
});

test("checker startup recovery is included in the actual image rehearsal", () => {
  const verify = readFileSync("ops/languagetool/verify.sh", "utf8");
  assert.match(verify, /bash ops\/languagetool\/test-startup\.sh/);
  assert.match(verify, /bash ops\/languagetool\/test-cold-start\.sh/);
});

test("only English pipelines are warmed before normal check deadlines apply", () => {
  const properties = readFileSync("ops/languagetool/server.properties", "utf8");
  assert.match(properties, /^pipelinePrewarming=true$/m);
  assert.match(properties, /^preferredLanguages=en-US$/m);
  assert.match(properties, /^maxCheckTimeMillis=10000$/m);
  assert.match(properties, /^maxPipelinePoolSize=1$/m);
  assert.match(properties, /^cacheSize=0$/m);
});
