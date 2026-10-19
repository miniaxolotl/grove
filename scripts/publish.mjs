import { readFile, mkdtemp, readdir, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const temporary = process.env.CI ? tmpdir() : "/tmp/opencode";
await mkdir(temporary, { recursive: true });
const directory = await mkdtemp(join(temporary, "grove-publish-"));
const pending = [];
try {
  // Preflight every artifact before publishing any package. A historical version
  // must never silently skip changed code while newer sibling packages publish.
  for (const name of [
    "api",
    "mcp",
    "grove-opencode-plugin",
    "grove-claude-plugin",
    "grove-codex-plugin",
  ]) {
    const path = join(root, "packages", name);
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    let integrity;
    try {
      integrity = execFileSync(
        "npm",
        ["view", `${pkg.name}@${pkg.version}`, "dist.integrity"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      if (!integrity)
        throw new Error(
          `Registry integrity missing for ${pkg.name}@${pkg.version}`,
        );
    } catch (error) {
      if (!String(error.stderr).includes("E404")) throw error;
    }
    const destination = join(directory, name);
    await mkdir(destination);
    execFileSync("pnpm", ["pack", "--pack-destination", destination], {
      cwd: path,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const archive = join(
      destination,
      (await readdir(destination)).find((file) => file.endsWith(".tgz")),
    );
    const digest = `sha512-${createHash("sha512")
      .update(await readFile(archive))
      .digest("base64")}`;
    if (integrity && integrity !== digest)
      throw new Error(
        `${pkg.name}@${pkg.version} is already published with different contents. Merge a new version release before publishing.`,
      );
    if (!integrity)
      pending.push({ archive, name: `${pkg.name}@${pkg.version}` });
  }
  for (const pkg of pending) {
    if (process.argv.includes("--dry-run"))
      process.stdout.write(`Would publish ${pkg.name}\n`);
    else
      execFileSync(
        "npm",
        ["publish", pkg.archive, "--access", "public", "--ignore-scripts"],
        { stdio: "inherit" },
      );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
