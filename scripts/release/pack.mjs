import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

export function packArtifact(source, destination) {
  destination = resolve(destination);
  mkdirSync(destination, { recursive: true });
  const directory = mkdtempSync(join(destination, ".pack-"));
  try {
    // pnpm resolves workspace ranges and selects publishable files, but its
    // asynchronous range conversion can reorder dependency keys across runs.
    execFileSync("pnpm", ["pack", "--pack-destination", directory], {
      cwd: source,
      stdio: "pipe",
    });
    const files = readdirSync(directory).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(files.length, 1);
    execFileSync("tar", [
      "--same-permissions",
      "-xzf",
      join(directory, files[0]),
      "-C",
      directory,
    ]);
    const unpacked = join(directory, "package");
    const manifest = join(unpacked, "package.json");
    writeFileSync(
      manifest,
      JSON.stringify(
        canonical(JSON.parse(readFileSync(manifest, "utf8"))),
        null,
        2,
      ) + "\n",
    );
    const result = JSON.parse(
      execFileSync(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          destination,
        ],
        { cwd: unpacked, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    assert.equal(result.length, 1);
    return join(destination, result[0].filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: pack.mjs <source-directory> <destination>",
  );
  process.stdout.write(`${packArtifact(process.argv[2], process.argv[3])}\n`);
}
