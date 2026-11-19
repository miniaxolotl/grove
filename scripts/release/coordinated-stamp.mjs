// Shared exact-stamp check for coordinated source admissions; no version policy
// lives here. Callers validate actual merged release intent with release-intent.
import assert from "node:assert/strict";
export function assertCoordinatedStamp(before, source, version, io) {
  const config = io.read(before, "release-please-config.json").packages["."];
  const fields = [
    ["package.json", ["version"]],
    [".release-please-manifest.json", ["."]],
    ...config["extra-files"].map(({ path, jsonpath }) => [
      path,
      jsonpath.slice(2).replace("[0]", ".0").split("."),
    ]),
  ];
  const allowed = new Set(["CHANGELOG.md", ...fields.map(([path]) => path)]);
  const paths = io
    .git("diff", "--name-only", "--no-renames", before, source)
    .split("\n");
  assert(
    paths.includes("CHANGELOG.md") && paths.every((path) => allowed.has(path)),
    "Unreviewed changes in coordinated release stamp",
  );
  for (const [path, keys] of fields) {
    const previous = io.read(before, path),
      after = io.read(source, path);
    let cursor = previous;
    for (const key of keys.slice(0, -1)) cursor = cursor[key];
    cursor[keys.at(-1)] = version;
    assert.deepEqual(
      after,
      previous,
      `Unexpected coordinated version or contents: ${path}`,
    );
  }
}
