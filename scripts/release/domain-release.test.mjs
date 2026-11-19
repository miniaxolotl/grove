import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as release from "./proofing-release.mjs";
const routeDomain = (...args) => release.routeDomain?.(...args);

const base = "ba78d851bfa5da0a9ce54efa9ac5d07ac9b2b52d";
const merged = "a".repeat(40),
  stamp = "b".repeat(40);
const config = JSON.parse(readFileSync("release-please-config.json"));
const pr = {
  number: 303,
  merged: true,
  base: { ref: "development" },
  head: {
    ref: "fix/release-grovenote-admission",
    repo: { full_name: "miniaxolotl/grove" },
  },
  merge_commit_sha: merged,
};
function fixture(extra = "", edit = () => {}, parent = base) {
  return {
    git: (cmd, ...args) =>
      cmd === "diff"
        ? `CHANGELOG.md\npackage.json${extra}`
        : args[0] === `${merged}^1`
          ? parent
          : merged,
    read: (ref, path) => {
      const version = ref === merged ? "1.11.28" : "1.11.29";
      const value =
        path === "release-please-config.json"
          ? globalThis.structuredClone(config)
          : path === ".release-please-manifest.json"
            ? { ".": version }
            : path.endsWith("marketplace.json")
              ? { plugins: [{ source: { version } }] }
              : { version };
      if (ref === stamp) edit(path, value);
      return value;
    },
  };
}
test("domain admission is bound to the reviewed development PR and unchanged baseline", () => {
  assert.equal(routeDomain(merged, pr, false, fixture()), "coordinated");
  assert.equal(routeDomain(merged, pr, true, fixture()), "website-only");
  for (const changed of [
    { ...pr, number: 302 },
    { ...pr, merged: false },
    { ...pr, base: { ref: "production" } },
    { ...pr, head: { ...pr.head, ref: "other" } },
    { ...pr, head: { ...pr.head, repo: { full_name: "other/grove" } } },
  ])
    assert.equal(
      routeDomain(merged, changed, false, fixture()),
      "website-only",
    );
  assert.equal(
    routeDomain(
      merged,
      pr,
      false,
      fixture("", () => {}, "c".repeat(40)),
    ),
    "website-only",
  );
});
test("only the direct coordinated patch stamp is admitted for production", () => {
  assert.equal(routeDomain(stamp, pr, true, fixture()), "coordinated");
  assert.throws(
    () => routeDomain(stamp, pr, true, fixture("\npackages/api/src/app.ts")),
    /Unreviewed/,
  );
  assert.throws(
    () =>
      routeDomain(
        stamp,
        pr,
        true,
        fixture("", (path, value) => {
          if (path === "packages/api/package.json") value.version = "1.11.28";
        }),
      ),
    /Unexpected/,
  );
  assert.throws(
    () =>
      routeDomain(
        stamp,
        pr,
        true,
        fixture("", (path, value) => {
          if (path === "package.json") value.scripts = { build: "changed" };
        }),
      ),
    /Unexpected/,
  );
});
test("domain release preserves existing topology instead of authorizing the historical checker", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /checker: \$\{\{ steps\.scope\.outputs\.checker \}\}/);
  assert.match(workflow, /if: needs\.candidate\.outputs\.checker == 'true'/);
  assert.match(workflow, /node scripts\/deploy-digitalocean\.mjs --propose/);
  assert.match(workflow, /node scripts\/deploy-digitalocean\.mjs --wait/);
});
