// The selected provider entry point: revalidate on *every* deploy-job retry.
// Provider request construction/acceptance remains in the existing reconciler.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import { resolveDecision } from "./selected-decision.mjs";
import { selectedServiceReadback } from "./selected-retry.mjs";
import * as provider from "../deploy-digitalocean.mjs";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";

export async function deploySelected(
  env,
  { resolve, current, verifyBaselines, readApp, fingerprint, deploy },
) {
  assert.match(env.RELEASE_DECISION_HASH ?? "", /^[a-f0-9]{64}$/);
  assert.match(env.GROVE_IMAGE_DIGEST ?? "", /^sha256:[a-f0-9]{64}$/);
  const decision = resolve(env.RELEASE_SOURCE_SHA);
  assert.equal(
    decision?.hash,
    env.RELEASE_DECISION_HASH,
    "Provider decision drift",
  );
  assert(
    decision.manifest.deliver.includes("service") &&
      decision.manifest.topology === "existing" &&
      !decision.manifest.publish.length,
    "Decision does not authorize hosted service delivery",
  );
  current();
  await verifyBaselines();
  const app = await readApp();
  assert.equal(app.id, env.DIGITALOCEAN_APP_ID);
  const complete = selectedServiceReadback(
    app,
    decision.manifest.receipts.service.identity,
    env.GROVE_IMAGE_DIGEST,
  );
  for (const [kind, name] of [
    ["services", "api"],
    ["workers", "worker"],
  ]) {
    const part = app.active_deployment.spec[kind].find((p) => p.name === name);
    assert.equal(part.image.registry, "miniaxolotl");
    assert.equal(part.image.repository, "grove");
  }
  assert(
    isDeepStrictEqual(app.spec, app.active_deployment.spec),
    "Reconcile desired/active spec drift before retry",
  );
  current();
  if (complete)
    return {
      action: "already-active",
      decisionHash: decision.hash,
      deploymentId: app.active_deployment.id,
    };
  const expected = fingerprint(app);
  assert.match(
    expected,
    /^[a-f0-9]{64}$/,
    "Invalid expected provider state fingerprint",
  );
  await deploy(expected);
  return { action: "deployed", decisionHash: decision.hash };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const env = process.env;
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    env.RELEASE_SOURCE_SHA,
  );
  assert.match(env.DIGITALOCEAN_APP_ID ?? "", /^[a-f0-9-]{36}$/);
  assert(env.DIGITALOCEAN_ACCESS_TOKEN);
  const outcome = await deploySelected(env, {
    resolve: (source) => resolveDecision(source, true),
    current: () => assertCurrentRef(workflowContext()),
    verifyBaselines: () =>
      execFileSync(
        process.execPath,
        ["scripts/release/verify-website-baselines.mjs"],
        {
          stdio: "inherit",
          env: { ...env, GROVE_SELECTED_IMAGE_DIGEST: env.GROVE_IMAGE_DIGEST },
        },
      ),
    readApp: async () => {
      const response = await globalThis.fetch(
        `https://api.digitalocean.com/v2/apps/${env.DIGITALOCEAN_APP_ID}`,
        {
          headers: { Authorization: `Bearer ${env.DIGITALOCEAN_ACCESS_TOKEN}` },
          redirect: "error",
          signal: globalThis.AbortSignal.timeout(30000),
        },
      );
      assert(
        response.ok,
        `Selected deployment preflight failed (HTTP ${response.status})`,
      );
      return (await response.json()).app;
    },
    fingerprint: (app) => {
      assert.equal(
        typeof provider.appStateFingerprint,
        "function",
        "Selected service delivery requires the provider expected-state fence prerequisite",
      );
      return provider.appStateFingerprint(app);
    },
    deploy: (expected) =>
      execFileSync(
        process.execPath,
        [
          "scripts/deploy-digitalocean.mjs",
          "--wait",
          "--expected-app-state",
          expected,
        ],
        { stdio: "inherit" },
      ),
  });
  console.log(JSON.stringify(outcome));
}
