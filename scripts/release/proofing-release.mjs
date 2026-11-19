// Explicit source-bound coordinated admissions; all other candidates must prove
// website-only impact. Never carry a historical topology grant into a new release.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolveDecision } from "./selected-decision.mjs";
import { assertCoordinatedStamp } from "./coordinated-stamp.mjs";
import { resolveHeldDecision } from "./held-delivery.mjs";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const read = (ref, path) => JSON.parse(git("show", `${ref}:${path}`));
const baseline = "6566c2dca78e7fde9c79357f8d07c5ad6f4cc7d5";
export const version = "1.11.28";
export function route(source, pr, released = false, io = { git, read }) {
  return routeBound(source, pr, released, io, {
    baseline,
    number: 293,
    before: "1.11.27",
    after: version,
  });
}
export function routeDomain(source, pr, released = false, io = { git, read }) {
  if (
    pr.head?.ref !== "fix/release-grovenote-admission" ||
    pr.head?.repo?.full_name !== "miniaxolotl/grove"
  )
    return "website-only";
  return routeBound(source, pr, released, io, {
    baseline: "ba78d851bfa5da0a9ce54efa9ac5d07ac9b2b52d",
    number: 303,
    before: "1.11.28",
    after: "1.11.29",
  });
}
function routeBound(source, pr, released, io, admission) {
  assert.match(source, /^[0-9a-f]{40}$/);
  const merged = pr.merge_commit_sha;
  if (
    !pr.merged ||
    pr.base?.ref !== "development" ||
    pr.number !== admission.number ||
    !/^[a-f0-9]{40}$/.test(merged)
  )
    return "website-only";
  // Squash/merge ancestry must start exactly at the reviewed product baseline.
  if (io.git("rev-parse", `${merged}^1`) !== admission.baseline)
    return "website-only";
  const stamp = io.read(source, "package.json").version;
  if (source === merged)
    return !released && stamp === admission.before
      ? "coordinated"
      : "website-only";
  if (
    stamp !== admission.after ||
    io.git("rev-parse", `${source}^1`) !== merged
  )
    return "website-only";
  assertCoordinatedStamp(merged, source, admission.after, io);
  return "coordinated";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const source = process.argv[2];
  const selected = resolveDecision(source, process.argv[3] === "released");
  const held = resolveHeldDecision(source, process.argv[3] === "released");
  assert(
    !(held && selected),
    "Choose held coordinated publication or selected hosted delivery, never both",
  );
  if (held) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=coordinated\nchecker=false\nconfig=release-please-config.json\nservice=true\nwebsite=false\nheld=true\nheldDecision=${held.hash}\n`,
    );
  } else if (selected) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=selected\nchecker=false\nconfig=release-please-website.json\nservice=${selected.manifest.deliver.includes("service")}\nwebsite=${selected.manifest.deliver.includes("website")}\ndecision=${selected.hash}\n`,
    );
  } else {
    const pull = (number) =>
      JSON.parse(
        execFileSync("gh", ["api", `repos/miniaxolotl/grove/pulls/${number}`], {
          encoding: "utf8",
        }),
      );
    const released = process.argv[3] === "released";
    const domain = routeDomain(source, pull(303), released);
    const historical =
      domain === "coordinated"
        ? "website-only"
        : route(source, pull(293), released);
    const mode = domain === "coordinated" ? domain : historical;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=${mode}\nchecker=${historical === "coordinated"}\nconfig=${mode === "coordinated" ? "release-please-config.json" : "release-please-website.json"}\n`,
    );
  }
}
