import { mkdtemp, mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const directory = await mkdtemp("/tmp/opencode/grove-native-");
const run = async (command, args, env) => {
  const result = await exec(command, args, {
    env: { ...process.env, ...env },
    cwd: directory,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  process.stdout.write(result.stdout);
  return result;
};
for (const agent of ["claude", "codex"]) {
  const packageDirectory = join(directory, "plugins", agent);
  await mkdir(packageDirectory, { recursive: true });
  await exec("pnpm", ["pack", "--pack-destination", packageDirectory], {
    cwd: join(root, `packages/grove-${agent}-plugin`),
  });
  const archive = (await readdir(packageDirectory)).find((name) =>
    name.endsWith(".tgz"),
  );
  await exec("tar", [
    "-xzf",
    join(packageDirectory, archive),
    "-C",
    packageDirectory,
    "--strip-components=1",
  ]);
}
await mkdir(join(directory, ".claude-plugin"));
await mkdir(join(directory, ".agents/plugins"), { recursive: true });
await writeFile(
  join(directory, ".claude-plugin/marketplace.json"),
  JSON.stringify({
    name: "grove-test",
    owner: { name: "Grove verification" },
    plugins: [{ name: "grove", source: "./plugins/claude" }],
  }),
);
await writeFile(
  join(directory, ".agents/plugins/marketplace.json"),
  JSON.stringify({
    name: "grove-test",
    plugins: [
      {
        name: "grove",
        source: { source: "local", path: "./plugins/codex" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  }),
);
const claude = process.env.CLAUDE_TEST_BIN;
const codex = process.env.CODEX_TEST_BIN;
if (!claude || !codex)
  throw new Error(
    "Set CLAUDE_TEST_BIN and CODEX_TEST_BIN to isolated installed host executables",
  );
const claudeEnv = { CLAUDE_CONFIG_DIR: join(directory, "claude-config") };
const codexEnv = { CODEX_HOME: join(directory, "codex-config") };
await mkdir(codexEnv.CODEX_HOME);
await run(claude, ["--version"], claudeEnv);
await run(claude, ["plugin", "marketplace", "add", directory], claudeEnv);
await run(
  claude,
  ["plugin", "install", "grove@grove-test", "--scope", "user"],
  claudeEnv,
);
await run(claude, ["plugin", "details", "grove@grove-test"], claudeEnv);
await run(codex, ["--version"], codexEnv);
await run(codex, ["plugin", "marketplace", "add", directory], codexEnv);
await run(codex, ["plugin", "add", "grove@grove-test", "--json"], codexEnv);
await run(codex, ["plugin", "list", "--json"], codexEnv);
const config = await readFile(join(codexEnv.CODEX_HOME, "config.toml"), "utf8");
if (!config.includes("grove@grove-test"))
  throw new Error("Codex did not enable the plugin");
await run(
  claude,
  ["plugin", "uninstall", "grove@grove-test", "--scope", "user"],
  claudeEnv,
);
await run(codex, ["plugin", "remove", "grove@grove-test", "--json"], codexEnv);
process.stdout.write(`Native installation evidence: ${directory}\n`);
