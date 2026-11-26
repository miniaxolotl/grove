// Protected recording/website composition. Provider and owner SQL writes belong
// exclusively to the qualified local operator, never this workflow.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import process from "node:process";
import { loadPublication, loadReceipt } from "./held-artifacts.mjs";
import { resolveHeldDecision } from "./held-delivery.mjs";
import {
  recordHeld,
  recordLifecycle,
  approve,
  advance,
  receiptHash,
} from "./held-state.mjs";
import {
  verifyHeld,
  verifyLifecycle,
  verifyHandoff,
  verifyRuntime,
  verifyPublic,
} from "./held-provider.mjs";
import { probeConsole } from "./held-console.mjs";
import { validateOperatorCommand } from "./held-operator.mjs";
import { preflightWebsite, deployWebsite } from "./website.mjs";
import { readProviderResponse } from "../deploy-digitalocean.mjs";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";

const env = process.env,
  git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const toolingRoot=process.cwd();
try {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REF, "refs/heads/production");
  assert.equal(env.GITHUB_REF_PROTECTED, "true");
  assert.equal(env.GITHUB_ACTOR, "miniaxolotl");
  const source = env.RELEASE_SOURCE_SHA;
  const operational=env.HELD_OPERATOR_SOURCE_SHA!==undefined;
  assert.equal(git("rev-parse", "HEAD"), operational?env.HELD_OPERATOR_SOURCE_SHA:source);
  if(operational){
    assert.equal(env.GITHUB_WORKFLOW_REF?.split('@')[0],env.GITHUB_REPOSITORY+'/.github/workflows/held-release-operator.yml');
    assert.match(env.RELEASE_PRODUCTION_SHA??'',/^[a-f0-9]{40}$/);
    assert.equal(git('rev-parse',`${env.RELEASE_PRODUCTION_SHA}^{tree}`),git('rev-parse',`${source}^{tree}`));
    git('merge-base','--is-ancestor',env.RELEASE_PRODUCTION_SHA,env.GITHUB_SHA);
    assert.equal(execFileSync('git',['-C',env.HELD_RELEASE_ROOT,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),source);
    assert.equal(git('rev-parse',`refs/tags/${env.RELEASE_TAG}^{commit}`),source);
  }
  const selected = resolveHeldDecision(source, true);
  assert(selected);
  const current = () => assertCurrentRef(workflowContext());
  current();
  const context = {
    repository: env.GITHUB_REPOSITORY,
    actor: env.GITHUB_ACTOR,
    protected: true,
    source,
    production: operational?env.RELEASE_PRODUCTION_SHA:env.GITHUB_SHA,
    tree: git("rev-parse", `${source}^{tree}`),
    tag: env.RELEASE_TAG,
    apiVersion: JSON.parse(git('show',`${source}:packages/api/package.json`))
      .version,
    run: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    heldDecision: selected.manifest,
    ...(operational?{tooling:{source:env.HELD_OPERATOR_SOURCE_SHA,production:env.GITHUB_SHA,tree:git('rev-parse','HEAD^{tree}'),tag:env.HELD_OPERATOR_TAG,workflow:'.github/workflows/held-release-operator.yml'}}:{}),
  };
  const p = await loadPublication(
    Number(env.HELD_PUBLICATION_RUN),
    Number(env.HELD_PUBLICATION_ATTEMPT),
    context,
  );
  assert.equal(env.DIGITALOCEAN_APP_ID, p.evidence.baseline.app);
  const phase = env.HELD_PHASE;
  const expected = {
    lifecycle: "held_verified",
    approve: "lifecycle_verified",
    runtime: "effects_approved",
    public: "runtime_verified",
    website: "public_verified",
  };
  let parent = p;
  if (phase !== "held") {
    assert(expected[phase]);
    parent = await loadReceipt(
      {
        run: Number(env.HELD_PREVIOUS_RUN),
        attempt: Number(env.HELD_PREVIOUS_ATTEMPT),
        phase: expected[phase],
        publication: p,
      },
      context,
    );
    assert.equal(parent.operator.run, Number(env.HELD_PREVIOUS_RUN));
    assert.equal(parent.operator.attempt, Number(env.HELD_PREVIOUS_ATTEMPT));
  }
  const request = async (path) => {
    assert(env.DIGITALOCEAN_ACCESS_TOKEN);
    const response = await globalThis.fetch(
      `https://api.digitalocean.com${path}`,
      {
        headers: { Authorization: `Bearer ${env.DIGITALOCEAN_ACCESS_TOKEN}` },
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(30000),
      },
    );
    return readProviderResponse(response, "GET", path);
  };
  const io = {
    getApp: async (id) => (await request(`/v2/apps/${id}`)).app,
    getInstances: async (id) => {
      const page = await request(`/v2/apps/${id}/instances`);
      assert(
        Array.isArray(page.instances) &&
          !page.links?.pages?.next &&
          !page.meta?.next_cursor,
      );
      return page.instances;
    },
    probe: (scope) => probeConsole(scope),
    ready: async () => {
      const response = await globalThis.fetch(
        "https://api.grovenote.app/health/ready",
        {
          cache: "no-store",
          redirect: "error",
          signal: globalThis.AbortSignal.timeout(30000),
        },
      );
      assert.equal(response.status, 200);
      return response.json();
    },
  };
  let receipt;
  if (phase === "held")
    receipt = recordHeld(p, await verifyHeld(p, io), context, Date.now());
  else if (phase === "lifecycle")
    receipt = recordLifecycle(
      p,
      parent,
      await verifyLifecycle(p, parent, io),
      context,
      Date.now(),
    );
  else if (phase === "approve") {
    const command = JSON.parse(env.HELD_COMMAND ?? "null");
    const hash = validateOperatorCommand(p, parent, command);
    assert.equal(command.action, "handoff");
    const snapshot = await verifyHandoff(p, parent, hash, io);
    const { control, ...actual } = snapshot.lifecycle;
    assert.equal(control.approvalHash, hash);
    const { control: priorControl, ...expectedEvidence } =
      parent.evidence.lifecycle;
    assert.equal(priorControl.phase, "reconcile");
    assert.deepEqual(actual, expectedEvidence);
    assert.equal(command.expected, receiptHash(expectedEvidence));
    receipt = approve(
      p,
      parent,
      {
        held: receiptHash(parent),
        authority: actual.authorityHash,
        providers: actual.remoteHash,
        pending: 0,
        uncertain: 0,
        reconciledAt: snapshot.observedAt,
        approved: true,
        command: hash,
      },
      context,
      Date.now(),
      ({ source, held, authority, providers }) => ({
        source,
        held,
        authority,
        providers,
        manifest: command.manifest,
        contract: "qualified-lifecycle-and-remote-reconciliation",
      }),
    );
  } else if (phase === "runtime")
    receipt = advance(
      p,
      parent,
      "runtime_verified",
      context,
      Date.now(),
      await verifyRuntime(p, parent, io),
    );
  else if (phase === "public") {
    const command = JSON.parse(env.HELD_COMMAND ?? "null"),
      hash = validateOperatorCommand(p, parent, command);
    assert.equal(command.action, "open-public");
    receipt = advance(
      p,
      parent,
      "public_verified",
      context,
      Date.now(),
      await verifyPublic(p, parent.parent, hash, io),
    );
  } else {
    assert.equal(parent.phase, "public_verified");
    await verifyPublic(p, parent.parent.parent, parent.evidence.command, io);
    if(operational)process.chdir(env.HELD_RELEASE_ROOT);
    const websiteEnv=operational?{...env,GITHUB_SHA:context.production}:env;
    await preflightWebsite(websiteEnv);
    const evidence = await deployWebsite(websiteEnv, {
      version: JSON.parse(readFileSync("package.json", "utf8")).version,
      assertCurrent: current,
      writeIdentity: (identity) =>
        writeFileSync(
          "packages/website/public/release.json",
          JSON.stringify(identity) + "\n",
        ),
      run: (args) =>
        execFileSync("npx", ["--yes", "vercel@65.2.0", ...args], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
          timeout: 20 * 60_000,
           env: { ...websiteEnv, VERCEL_GIT_COMMIT_SHA: source },
        }),
    });
    await verifyPublic(p, parent.parent.parent, parent.evidence.command, io);
    receipt = advance(
      p,
      parent,
      "website_verified",
      context,
      Date.now(),
      evidence,
    );
  }
  current();
  process.chdir(toolingRoot);
  writeFileSync("held-state.json", JSON.stringify(receipt) + "\n");
  assert(env.GITHUB_OUTPUT);
  appendFileSync(env.GITHUB_OUTPUT, `phase=${receipt.phase}\n`);
} catch {
  process.stderr.write(
    "Held continuation unverified; retain persisted phase and reconcile exact custody read-only. No service delivery receipt was emitted.\n",
  );
  process.exitCode = 1;
}
