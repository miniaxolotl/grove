import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { packArtifact } from "./pack.mjs";

test("packed bytes are reproducible across manifest key order and output paths, while content changes remain detectable", () => {
  const directory = mkdtempSync(
    join(process.env.CI ? tmpdir() : "/tmp/opencode", "grove-pack-test-"),
  );
  try {
    const source = join(directory, "source");
    mkdirSync(source);
    const file = join(source, "package.json");
    writeFileSync(join(source, "index.js"), "export const value = 1;\n");
    const pkg = {
      name: "reproducible-fixture",
      version: "1.0.0",
      files: ["index.js"],
      devDependencies: { z: "1.0.0", a: "2.0.0" },
    };
    writeFileSync(file, JSON.stringify(pkg));
    const first = readFileSync(packArtifact(source, join(directory, "first")));
    writeFileSync(
      file,
      JSON.stringify({ ...pkg, devDependencies: { a: "2.0.0", z: "1.0.0" } }),
    );
    assert.deepEqual(
      readFileSync(packArtifact(source, join(directory, "second"))),
      first,
    );
    writeFileSync(join(source, "index.js"), "export const value = 2;\n");
    assert.notDeepEqual(
      readFileSync(packArtifact(source, join(directory, "changed"))),
      first,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
