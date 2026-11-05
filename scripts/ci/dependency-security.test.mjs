import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const lock = readFileSync(
  new URL("../../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
const atLeast = (version, minimum) =>
  version.localeCompare(minimum, "en", { numeric: true }) >= 0;
const safe = {
  minimatch: (v) => Number(v.split(".")[0]) < 7 || atLeast(v, "11.0.1"),
  glob: (v) => Number(v.split(".")[0]) < 9 || atLeast(v, "14.0.2"),
  "brace-expansion": (v) =>
    atLeast(
      v,
      { 1: "1.1.21", 2: "2.1.7", 3: "3.0.9" }[v.split(".")[0]] ?? "5.0.12",
    ),
  esbuild: (v) => atLeast(v, "0.28.1"),
};

for (const [name, accepts] of Object.entries(safe)) {
  test(`locked ${name} versions exclude affected security ranges`, () => {
    const versions = new Set(
      [
        ...lock.matchAll(new RegExp(`^  ${name}@(\\d+\\.\\d+\\.\\d+):`, "gm")),
      ].map((match) => match[1]),
    );
    assert.ok(versions.size, `No ${name} package records found`);
    assert.deepEqual(
      [...versions].filter((version) => !accepts(version)),
      [],
    );
  });
}
