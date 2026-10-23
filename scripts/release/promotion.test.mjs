import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCandidate,
  assertCi,
  assertSelection,
  promotionTag,
} from "./promotion.mjs";

const sha = "a".repeat(40);
const tree = "b".repeat(40);
const policy = {
  repository: "owner/app",
  branches: ["development", "production"],
};
const candidate = {
  tag: "v1.2.3",
  sha,
  tree,
  version: "1.2.3",
  manifestVersion: "1.2.3",
  release: { tag_name: "v1.2.3", draft: false },
  releasePr: {
    merged_at: "2026-10-20",
    merge_commit_sha: sha,
    base: { ref: "development", repo: { full_name: "owner/app" } },
    head: { repo: { full_name: "owner/app" } },
    labels: [{ name: "autorelease:tagged" }],
  },
};

test("bot promotions require operator-triggered, exact-candidate workflow evidence", () => {
  const settings = { ...policy, operator: "release-owner" };
  const pr = { number: 17, head: { sha }, base: { ref: "production" } };
  const run = {
    id: 123,
    event: "workflow_dispatch",
    head_branch: "development",
    head_repository: { full_name: policy.repository },
    path: ".github/workflows/promote.yml",
    actor: { login: "release-owner" },
    triggering_actor: { login: "release-owner" },
    head_sha: "c".repeat(40),
  };
  const record = {
    repository: policy.repository,
    run: 123,
    tooling: run.head_sha,
    pr: 17,
    head: sha,
    target: "production",
    tag: candidate.tag,
    sha,
    tree,
  };
  assert.doesNotThrow(() =>
    assertSelection(settings, pr, candidate, run, record),
  );
  for (const change of [
    { event: "push" },
    { head_branch: "feature/forged" },
    { path: ".github/workflows/other.yml" },
    { actor: { login: "other" } },
    { triggering_actor: { login: "other" } },
  ]) {
    assert.throws(
      () =>
        assertSelection(settings, pr, candidate, { ...run, ...change }, record),
      /Unauthorized/,
    );
  }
  for (const change of [
    { tag: "v9.9.9" },
    { head: "d".repeat(40) },
    { sha: "d".repeat(40) },
    { tree: "d".repeat(40) },
    { pr: 18 },
    { target: "staging" },
    { run: 124 },
    { tooling: "d".repeat(40) },
  ]) {
    assert.throws(
      () =>
        assertSelection(settings, pr, candidate, run, { ...record, ...change }),
      /evidence mismatch/,
    );
  }
});

test("promotion accepts a different merge SHA only with the frozen release tree", () => {
  assert.doesNotThrow(() => assertCandidate(policy, candidate, tree));
  assert.throws(
    () => assertCandidate(policy, candidate, "c".repeat(40)),
    /tree/,
  );
  assert.throws(
    () =>
      assertCandidate(policy, { ...candidate, manifestVersion: "1.2.2" }, tree),
    /version/,
  );
});

test("a manually tagged or foreign release cannot authorize publication", () => {
  assert.throws(
    () => assertCandidate(policy, { ...candidate, releasePr: null }, tree),
    /Release Please/,
  );
  const releasePr = {
    ...candidate.releasePr,
    merge_commit_sha: "c".repeat(40),
  };
  assert.throws(
    () => assertCandidate(policy, { ...candidate, releasePr }, tree),
    /Release Please/,
  );
  assert.throws(
    () =>
      assertCandidate(
        policy,
        { ...candidate, release: { ...candidate.release, draft: true } },
        tree,
      ),
    /release/,
  );
});

test("only frozen same-repository promotion refs may target downstream branches", () => {
  const pr = {
    base: { ref: "production" },
    head: {
      ref: "promote/production/v1.2.3",
      repo: { full_name: "owner/app" },
    },
  };
  assert.equal(promotionTag(policy, pr), "v1.2.3");
  assert.throws(
    () =>
      promotionTag(policy, { ...pr, head: { ...pr.head, ref: "development" } }),
    /frozen/,
  );
  assert.throws(
    () =>
      promotionTag(policy, {
        ...pr,
        head: { ...pr.head, repo: { full_name: "fork/app" } },
      }),
    /repository/,
  );
  assert.throws(
    () => promotionTag(policy, { ...pr, base: { ref: "staging" } }),
    /target/,
  );
});

test("failed, PR-only, stale, self and incomplete CI cannot qualify a candidate", () => {
  const run = {
    id: 1,
    path: ".github/workflows/ci.yml",
    run_attempt: 2,
    head_sha: sha,
    event: "push",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "owner/app" },
  };
  const jobs = ["test", "CI Gate"].map((name) => ({
    name,
    run_id: 1,
    run_attempt: 2,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  }));
  assert.equal(
    assertCi(run, jobs, {
      repository: "owner/app",
      sha,
      required: ["test", "CI Gate"],
      exclude: 2,
    }),
    true,
  );
  for (const change of [
    { event: "pull_request" },
    { head_sha: "c".repeat(40) },
    { conclusion: "failure" },
    { id: 2 },
    { path: ".github/workflows/other.yml" },
    { run_attempt: 0 },
  ]) {
    assert.equal(
      assertCi({ ...run, ...change }, jobs, {
        repository: "owner/app",
        sha,
        required: ["test", "CI Gate"],
        exclude: 2,
      }),
      false,
    );
  }
  assert.equal(
    assertCi(run, jobs.slice(1), {
      repository: "owner/app",
      sha,
      required: ["test", "CI Gate"],
    }),
    false,
  );
  assert.equal(
    assertCi(run, [...jobs, jobs[0]], {
      repository: "owner/app",
      sha,
      required: ["test", "CI Gate"],
    }),
    false,
  );
  for (const change of [
    { run_id: 9 },
    { run_attempt: 1 },
    { head_sha: "d".repeat(40) },
    { conclusion: "skipped" },
  ]) {
    assert.equal(
      assertCi(run, [{ ...jobs[0], ...change }, jobs[1]], {
        repository: "owner/app",
        sha,
        required: ["test", "CI Gate"],
      }),
      false,
    );
  }
});
