import { build } from "esbuild";
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { telemetryBuild } from "./release/telemetry-build.mjs";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const targets = {
  api: {
    directory: "packages/api",
    entries: ["server", "worker", "migrate", "bootstrap"],
  },
  mcp: {
    directory: "packages/mcp",
    entries: ["index", "cli", "bridge", "hook"],
  },
  opencode: { directory: "packages/grove-opencode-plugin", entries: ["index"] },
};
const selected =
  process.argv[2] === "opencode"
    ? ["mcp", "opencode"]
    : process.argv[2]
      ? [process.argv[2]]
      : Object.keys(targets);
for (const name of selected) {
  const target = targets[name];
  if (!target) throw new Error(`Unknown target ${name}`);
  const pkg = JSON.parse(
    await readFile(`${target.directory}/package.json`, "utf8"),
  );
  const externals =
    name === "api"
      ? Object.keys(pkg.dependencies)
      : name === "opencode"
        ? ["@opencode/plugin"]
        : [];
  const component =
    name === "api" ? "api" : name === "opencode" ? "opencode" : "cli";
  const telemetry = telemetryBuild(process.env, pkg.version, component);
  await build({
    entryPoints: target.entries.map(
      (entry) => `${target.directory}/src/${entry}.ts`,
    ),
    outdir: `${target.directory}/dist`,
    bundle: true,
    platform: "node",
    mainFields: ["module", "main"],
    target: "node22",
    format: "esm",
    define: { __GROVE_TELEMETRY__: JSON.stringify(telemetry) },
    sourcemap: true,
    banner: {
      js: 'import { createRequire as __groveCreateRequire } from "node:module"; const require = __groveCreateRequire(import.meta.url);',
    },
    external: externals,
    logLevel: "info",
  });
  await writeFile(
    `${target.directory}/dist/telemetry-build.json`,
    JSON.stringify({
      enabled: telemetry.enabled,
      revision: telemetry.revision,
      version: telemetry.version,
      component,
    }) + "\n",
  );
  if (name === "opencode")
    await copyFile(
      "packages/grove-claude-plugin/skills/memory/SKILL.md",
      `${target.directory}/dist/memory-skill.md`,
    );
}
if (selected.includes("mcp")) {
  for (const agent of ["claude", "codex", "opencode"]) {
    const directory = `packages/grove-${agent}-plugin/dist`;
    await mkdir(directory, { recursive: true });
    for (const entry of ["cli", "bridge", "hook"]) {
      for (const extension of ["js", "js.map"])
        await copyFile(
          `packages/mcp/dist/${entry}.${extension}`,
          `${directory}/${entry}.${extension}`,
        );
    }
  }
}
