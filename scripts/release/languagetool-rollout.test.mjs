import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { test } from "node:test";
import { updateImageSpec } from "../deploy-digitalocean.mjs";

const current = JSON.parse(readFileSync(".do/app.json", "utf8"));
const digest = current.services[0].image.digest;
const lt = `sha256:${"b".repeat(64)}`;
const staged = updateImageSpec(current, digest, lt);
const id = "00000000-0000-4000-8000-000000000000";

function propose(desired, active, args = [], actions = false) {
  // The real CLI parses its arguments and provider readback; no external I/O.
  const stub = `globalThis.fetch = async (url, {method, body}) => {
    if (url.endsWith('/apps/${id}') && method === 'GET') return Response.json({app: {
      id: '${id}', spec: ${JSON.stringify(desired)}, active_deployment: {id:'active',phase:'ACTIVE',spec:${JSON.stringify(active)}}
    }});
    if (url.endsWith('/apps/propose') && method === 'POST') return Response.json({app_cost:0});
    throw Error('Unexpected provider operation');
  }`;
  return spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(stub)}`,
      "scripts/deploy-digitalocean.mjs",
      "--app-id",
      id,
      "--digest",
      digest,
      "--propose",
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        DIGITALOCEAN_ACCESS_TOKEN: "fixture",
        GITHUB_ACTIONS: String(actions),
      },
    },
  );
}

test("ordinary releases cannot activate or remove a pending unaccepted checker", () => {
  assert.equal(propose(current, current).status, 0);
  assert.equal(propose(staged, staged).status, 0);
  for (const [desired, active] of [
    [staged, current],
    [current, staged],
    [updateImageSpec(staged, digest, `sha256:${"d".repeat(64)}`), staged],
  ]) {
    assert.notEqual(propose(desired, active).status, 0);
  }
});

test("only the independent operator path can propose the new checker", () => {
  const args = ["--languagetool-digest", lt];
  assert.notEqual(propose(current, current, args, true).status, 0);
  assert.notEqual(
    propose(current, updateImageSpec(current, `sha256:${"d".repeat(64)}`), args)
      .status,
    0,
  );
  const result = propose(current, current, args);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).languagetoolDigest, lt);
});
