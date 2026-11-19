// One coordinated release: the reviewed recovery merge (includes #282, #286 and #287) and its patch-version stamp.
// Future candidates go through normal website-impact admission.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const read = (ref, path) => JSON.parse(git("show", `${ref}:${path}`));
const baseline = "947a4e62c5c84a4c34ef540a0dacfa7ebe06b187";
export const version = "1.11.27";
export function route(source, pr, released = false, io = { git, read }) {
  assert.match(source, /^[0-9a-f]{40}$/);
  const merged = pr.merge_commit_sha;
  if (
    !pr.merged ||
    pr.base?.ref !== "development" ||
    pr.number !== 289 ||
    !/^[a-f0-9]{40}$/.test(merged)
  )
    return "website-only";
  // Squash/merge ancestry must start exactly at the reviewed product baseline.
  if (io.git("rev-parse", `${merged}^1`) !== baseline) return "website-only";
  const stamp = io.read(source, "package.json").version;
  if (source === merged)
    return !released && stamp === "1.11.26" ? "coordinated" : "website-only";
  if (stamp !== version || io.git("rev-parse", `${source}^1`) !== merged)
    return "website-only";
  const config = io.read(merged, "release-please-config.json").packages["."];
  const fields = [
    ["package.json", ["version"]],
    [".release-please-manifest.json", ["."]],
    ...config["extra-files"].map(({ path, jsonpath }) => [
      path,
      jsonpath.slice(2).replace("[0]", ".0").split("."),
    ]),
  ];
  const allowed = new Set(["CHANGELOG.md", ...fields.map(([p]) => p)]);
  const paths = io
    .git("diff", "--name-only", "--no-renames", merged, source)
    .split("\n");
  assert(
    paths.includes("CHANGELOG.md") && paths.every((p) => allowed.has(p)),
    "Unreviewed changes in coordinated release stamp",
  );
  for (const [path, keys] of fields) {
    const before = io.read(merged, path),
      after = io.read(source, path);
    let cursor = before;
    for (const key of keys.slice(0, -1)) cursor = cursor[key];
    cursor[keys.at(-1)] = version;
    assert.deepEqual(
      after,
      before,
      `Unexpected coordinated version or contents: ${path}`,
    );
  }
  return "coordinated";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const source = process.argv[2];
  const pr = JSON.parse(
    execFileSync("gh", ["api", "repos/miniaxolotl/grove/pulls/289"], {
      encoding: "utf8",
    }),
  );
  const mode = route(source, pr, process.argv[3] === "released");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `mode=${mode}\nconfig=${mode === "coordinated" ? "release-please-config.json" : "release-please-website.json"}\n`,
  );
}
