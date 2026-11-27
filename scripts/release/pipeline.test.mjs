import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import test from "node:test";
import * as promotion from "./promotion.mjs";

const read = (name) => readFileSync(`.github/workflows/${name}.yml`, "utf8");

test("promotion preview observes native CI using trusted tooling with no write permissions", () => {
  assert.ok(
    existsSync(".github/workflows/promotion-preview.yml"),
    "Read-only observer required",
  );
  const workflow = read("promotion-preview");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflow_run.event == 'pull_request'/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /promotion\.mjs preview/);
  assert.doesNotMatch(
    workflow,
    /: write|secrets\.|workflow_dispatch:|download-artifact|pr merge|enablePullRequestAutoMerge/,
  );
});

test("ordinary changes use one coordinated Release Please config without impact declarations", () => {
  const source = read("release");
  assert.match(source, /config-file: release-please-config\.json/);
  assert.doesNotMatch(
    source,
    /website-impact|needs\.scope|proofing-release|reviewed-inputs/,
  );
  assert.match(source, /dispatch-ci\.mjs/);
});

test("Source Release prepares the exact tagged source automatically, including on retry", () => {
  const source = read("release");
  assert.match(source, /git fetch origin --tags/);
  assert.match(
    source,
    /id: selection[\s\S]*run: node scripts\/release\/promotion\.mjs auto/,
  );
  // Do not depend on release_created: Release Please already tagged the source
  // if a previous attempt failed during promotion or its generated CI dispatch.
  const prepare = source.split("- id: selection")[1];
  assert(prepare);
  assert.doesNotMatch(prepare.split("- name:")[0], /release_created/);
  assert.match(
    source,
    /PROMOTION_PR: \$\{\{ steps\.selection\.outputs\.pr \}\}/,
  );
});

test("production follows candidate, publish, backend, website with no special release modes", () => {
  const deploy = read("deploy");
  assert.match(deploy, /publish:\n\s+needs: candidate/);
  assert.match(deploy, /deploy:\n\s+needs: \[candidate, publish\]/);
  assert.match(deploy, /website:\n\s+needs: \[candidate, deploy\]/);
  assert.doesNotMatch(
    deploy,
    /website-scope|website-only|selected-deploy|proofing-release|held-production|outputs\.mode|outputs\.held|retire_held_runtime/,
  );
  assert.match(deploy, /node scripts\/publish\.mjs/);
  assert.match(deploy, /database-preflight\.mjs/);
  assert.match(deploy, /assets\.mjs/);
  assert.match(deploy, /node scripts\/release\/website\.mjs deploy/);
});

test("automatic promotion evidence is exact-source trusted Source Release, not an expiring artifact", () => {
  assert.equal(typeof promotion.assertAutomaticSelection, "function");
  const policy = { repository: "owner/app" };
  const candidate = { sha: "a".repeat(40) };
  const run = {
    path: ".github/workflows/release.yml",
    head_branch: "development",
    head_sha: candidate.sha,
    head_repository: { full_name: policy.repository },
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  assert.doesNotThrow(() =>
    promotion.assertAutomaticSelection(policy, candidate, run),
  );
  for (const change of [
    { path: ".github/workflows/ci.yml" },
    { head_branch: "feature/untrusted" },
    { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "fork/app" } },
    { event: "pull_request" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "cancelled" },
  ])
    assert.throws(() =>
      promotion.assertAutomaticSelection(policy, candidate, {
        ...run,
        ...change,
      }),
    );
});

test("only an exact source tag is eligible for automatic promotion", () => {
  assert.equal(typeof promotion.releasedTag, "function");
  const source = "a".repeat(40);
  const io = {
    read: () => ({ version: "1.2.3" }),
    git: (...args) => {
      assert.deepEqual(args, [
        "tag",
        "--points-at",
        source,
        "--list",
        "v1.2.3",
      ]);
      return "v1.2.3";
    },
  };
  assert.equal(promotion.releasedTag(source, io), "v1.2.3");
  assert.equal(promotion.releasedTag(source, { ...io, git: () => "" }), null);
});

test("actual automatic release CLI skips ordinary commits, freezes one tested tag and reuses it on retry", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "grove-promotion-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ version: "7.0.1" }),
  );
  writeFileSync(
    join(cwd, ".release-please-manifest.json"),
    JSON.stringify({ ".": "7.0.1" }),
  );
  git("add", ".");
  git("commit", "-qm", "previous");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, "source"), "tested source\n");
  git("add", ".");
  git("commit", "-qm", "release");
  const source = git("rev-parse", "HEAD"),
    tree = git("rev-parse", "HEAD^{tree}");
  git("update-ref", "refs/remotes/origin/development", source);
  const policy = JSON.parse(
    readFileSync("scripts/release/policy.json", "utf8"),
  );
  const statePath = join(cwd, "state.json");
  writeFileSync(
    statePath,
    JSON.stringify({ source, tree, base, writes: 0, policy }),
  );
  writeFileSync(
    join(cwd, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs'), cp = require('node:child_process');
const args=process.argv.slice(2);
const file=process.env.FIXTURE_STATE, s=JSON.parse(fs.readFileSync(file)), repo=s.policy.repository;
if(args[0]==='run'&&args[1]==='watch'){s.running=false;s.watches=(s.watches??0)+1;fs.writeFileSync(file,JSON.stringify(s));process.exit(0);}
const path=args.find(a=>a.startsWith('repos/')).split('/').slice(3).join('/');
const write=args.includes('--input'), body=write?JSON.parse(fs.readFileSync(0,'utf8')):null;
let result;
if(path.startsWith('releases/tags/')) result={tag_name:'v7.0.1',draft:false};
else if(path.startsWith('commits/')) result=[{number:12,user:{login:'github-actions[bot]',type:'Bot'},merged_at:'2026-11-26',merge_commit_sha:s.source,base:{ref:'development',repo:{full_name:repo}},head:{ref:'release-please--branches--development--components--grove',repo:{full_name:repo}},labels:[{name:'autorelease:tagged'}],...s.releasePrOverride}];
else if(path.startsWith('actions/workflows/')) result={workflow_runs:[{id:99,path:'.github/workflows/ci.yml',run_attempt:1,head_sha:s.source,event:'push',status:'completed',conclusion:'success',head_repository:{full_name:repo}}]};
else if(path==='actions/runs/123') result={path:'.github/workflows/release.yml',head_branch:'development',head_sha:s.source,head_repository:{full_name:repo},event:'push',status:s.running?'in_progress':'completed',conclusion:'success',...s.runOverride};
else if(path==='actions/runs/321') result={id:321,path:'.github/workflows/ci.yml',pull_requests:[{number:17,base:{ref:'production',sha:s.base},head:{ref:s.pr.head.ref,sha:s.frozen}}],head_branch:s.pr.head.ref,head_sha:s.frozen,head_repository:{full_name:repo},event:'pull_request',status:'completed',conclusion:'success',run_attempt:1,...s.nativeOverride};
else if(path.startsWith('actions/runs/321/attempts/1/jobs')) result={jobs:['Promotion Admission','CI Gate'].map(name=>({name,run_id:321,run_attempt:1,head_sha:s.frozen,status:'completed',conclusion:'success',...s.jobOverride}))};
else if(path==='branches/production') result={protected:true,commit:{sha:s.base},...s.baseOverride};
else if(path.startsWith('actions/runs/')) result={jobs:s.policy.ciJobs.map(name=>({name,run_id:99,run_attempt:1,head_sha:s.source,status:'completed',conclusion:'success'}))};
else if(path==='git/ref/heads/production') result={object:{sha:s.base}};
else if(path.startsWith('pulls?')) result=s.pr?[s.pr]:[];
else if(path==='git/commits') result={sha:cp.execFileSync('git',['commit-tree',body.tree,...body.parents.flatMap(p=>['-p',p]),'-m',body.message],{encoding:'utf8'}).trim()};
else if(path.startsWith('git/matching-refs/')) result=[];
else if(path==='git/refs') {cp.execFileSync('git',['update-ref',body.ref,body.sha]);s.frozen=body.sha;result={};}
else if(path==='pulls') {s.pr={number:17,node_id:'PR_fixture',state:'open',draft:false,html_url:'https://example.invalid/pr/17',user:{login:'github-actions[bot]',type:'Bot'},body:body.body,head:{sha:s.frozen,ref:body.head,repo:{full_name:repo}},base:{ref:body.base,repo:{full_name:repo}}};result=s.pr;}
else if(path.startsWith('issues/')) result={};
else throw Error('Unexpected fixture API '+path);
if(write)s.writes++;
fs.writeFileSync(file,JSON.stringify(s));
process.stdout.write((args.includes('--include')?'HTTP/2.0 200 OK\\n\\n':'')+JSON.stringify(result));
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${cwd}:${process.env.PATH}`,
    FIXTURE_STATE: statePath,
    GH_TOKEN: "fixture",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: policy.repository,
    GITHUB_REF: "refs/heads/development",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_WORKFLOW_REF: `${policy.repository}/.github/workflows/release.yml@refs/heads/development`,
    GITHUB_SHA: source,
    GITHUB_RUN_ID: "123",
    GITHUB_OUTPUT: join(cwd, "outputs"),
  };
  const run = (patch = {}) =>
    spawnSync(
      process.execPath,
      [resolve("scripts/release/promotion.mjs"), "auto"],
      {
        cwd,
        env: { ...env, ...patch },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nothing to promote/);
  assert.equal(JSON.parse(readFileSync(statePath)).writes, 0);
  git("tag", "v7.0.1");
  for (const patch of [
    { GITHUB_REF_PROTECTED: "false" },
    { GITHUB_SHA: base },
    {
      GITHUB_WORKFLOW_REF: `${policy.repository}/.github/workflows/ci.yml@refs/heads/development`,
    },
  ])
    assert.notEqual(run(patch).status, 0);
  result = run();
  assert.equal(result.status, 0, result.stderr);
  const first = JSON.parse(readFileSync(statePath));
  assert.equal(git("rev-parse", `${first.frozen}^{tree}`), tree);
  assert.match(first.pr.body, /<!-- release-source:123 -->/);
  assert.equal(first.pr.head.ref, "promote/production/v7.0.1");
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(readFileSync(statePath)).writes,
    first.writes,
    "Retry must not recreate or move the frozen candidate",
  );
  assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /pr=17/);
  const preview = () =>
    spawnSync(
      process.execPath,
      [resolve("scripts/release/promotion.mjs"), "preview", "321"],
      { cwd, env, encoding: "utf8", timeout: 15000 },
    );
  result = preview();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).input, {
    pullRequestId: "PR_fixture",
    expectedHeadOid: first.frozen,
    mergeMethod: "MERGE",
  });
  for (const override of [
    { nativeOverride: { event: "workflow_dispatch" } },
    { nativeOverride: { status: "waiting", conclusion: null } },
    { nativeOverride: { head_sha: base } },
    { nativeOverride: { pull_requests: [] } },
    { jobOverride: { conclusion: "skipped" } },
    { baseOverride: { protected: false } },
    { baseOverride: { commit: { sha: source } } },
    { releasePrOverride: { user: { login: "other", type: "User" } } },
    { pr: { ...first.pr, body: "<!-- release-selection:123 -->" } },
    { pr: { ...first.pr, state: "closed" } },
  ]) {
    writeFileSync(statePath, JSON.stringify({ ...first, ...override }));
    assert.notEqual(preview().status, 0, JSON.stringify(override));
    assert.equal(JSON.parse(readFileSync(statePath)).writes, first.writes);
  }
  writeFileSync(statePath, JSON.stringify(first));
  const event = join(cwd, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: first.pr }));
  const admit = () =>
    spawnSync(
      process.execPath,
      [resolve("scripts/release/promotion.mjs"), "admit"],
      {
        cwd,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...env,
          GITHUB_EVENT_PATH: event,
          GITHUB_REF_NAME: first.pr.head.ref,
        },
      },
    );
  result = admit();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v7.0.1/);
  writeFileSync(
    statePath,
    JSON.stringify({ ...JSON.parse(readFileSync(statePath)), running: true }),
  );
  result = admit();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(readFileSync(statePath)).watches,
    1,
    "Admission waits for the source workflow, not an artifact",
  );
  for (const runOverride of [{ conclusion: "failure" }, { head_sha: base }]) {
    writeFileSync(
      statePath,
      JSON.stringify({ ...JSON.parse(readFileSync(statePath)), runOverride }),
    );
    result = admit();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact-source Source Release/);
  }
});
