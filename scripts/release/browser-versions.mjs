import assert from "node:assert/strict";

export function resolveBrowserVersions(product, versions) {
  const targets = ["chrome", "edge", "firefox"];
  if (versions === undefined)
    versions = Object.fromEntries(targets.map((target) => [target, product]));
  assert.deepEqual(
    Object.keys(versions).sort(),
    targets,
    "Incomplete browser version inventory",
  );
  for (const version of Object.values(versions)) {
    assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.ok(
      version.split(".").every((n) => Number(n) <= 65535),
      "Browser version out of range",
    );
  }
  return versions;
}
