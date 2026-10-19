import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import process from "node:process";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
// Keep consumer artifacts outside the source checkout and its discovery rules.
const base = "/tmp/opencode";
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, "opencode-"));
const binary = process.env.OPENCODE_TEST_BIN || "opencode";
await exec("pnpm", ["pack", "--pack-destination", directory], {
  cwd: join(root, "packages/grove-opencode-plugin"),
});
const archive = (await readdir(directory)).find((name) =>
  name.endsWith(".tgz"),
);
await exec(
  "npm",
  [
    "install",
    "--prefix",
    directory,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, archive),
  ],
  { timeout: 120000 },
);
const pluginPath = join(
  directory,
  "node_modules/@miniaxolotl/grove-opencode-plugin",
);
await mkdir(join(directory, "config/opencode"), { recursive: true });
await writeFile(
  join(directory, "config/opencode/opencode.json"),
  JSON.stringify({ plugins: [pathToFileURL(pluginPath).href] }),
);
await mkdir(join(directory, "temp"));
const env = {
  ...process.env,
  HOME: directory,
  TMPDIR: join(directory, "temp"),
  XDG_CONFIG_HOME: join(directory, "config"),
  XDG_DATA_HOME: join(directory, "data"),
  XDG_CACHE_HOME: join(directory, "cache"),
  XDG_STATE_HOME: join(directory, "state"),
  GROVE_CONFIG_HOME: join(directory, "grove"),
  GROVE_API_URL: "http://127.0.0.1:34148",
  GROVE_PRIVATE: "1",
};
delete env.GROVE_API_KEY;
for (const name of Object.keys(env))
  if (name.startsWith("OPENCODE_")) delete env[name];
env.OPENCODE_PASSWORD = randomUUID();
const child = spawn(binary, ["serve", "--stdio", "--port", "0"], {
  cwd: directory,
  env,
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.resume();
const url = await new Promise((resolve, reject) => {
  const timer = globalThis.setTimeout(() => {
    child.kill("SIGTERM");
    reject(new Error("Isolated OpenCode startup timed out"));
  }, 30000);
  const fail = (error) => {
    globalThis.clearTimeout(timer);
    child.kill("SIGTERM");
    reject(error);
  };
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("\n")) {
      try {
        globalThis.clearTimeout(timer);
        resolve(JSON.parse(output.split("\n")[0]).url);
      } catch (error) {
        fail(error);
      }
    }
  });
  child.once("error", fail);
  child.once("exit", () =>
    fail(new Error("Isolated OpenCode exited before startup")),
  );
});
const read = async (path) => {
  const result = await exec(
    binary,
    [
      "api",
      "--server",
      url,
      "get",
      `${path}?location[directory]=${encodeURIComponent(directory)}`,
    ],
    { cwd: directory, env, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(result.stdout);
};
try {
  await exec(
    binary,
    [
      "api",
      "--server",
      url,
      "post",
      "/api/session",
      "--data",
      JSON.stringify({
        title: "Grove plugin verification",
        location: { directory },
      }),
    ],
    { cwd: directory, env, timeout: 60000 },
  );
  let plugins, mcp;
  for (let i = 0; i < 40; i++) {
    plugins = await read("/api/plugin");
    mcp = await read("/api/mcp");
    if (
      mcp.data.some(
        (server) =>
          server.name === "grove" && server.status.status === "connected",
      )
    )
      break;
    await setTimeout(250);
  }
  const skills = await read("/api/skill");
  process.stdout.write(
    JSON.stringify(
      {
        version: (await exec(binary, ["--version"])).stdout.trim(),
        plugins: plugins.data.filter(
          (plugin) => plugin.source.type !== "builtin",
        ),
        skills: skills.data.map(({ id, name }) => ({ id, name })),
        mcp,
        directory,
      },
      null,
      2,
    ) + "\n",
  );
  assert(plugins.data.some((plugin) => plugin.id === "grove"));
  assert(skills.data.some((skill) => skill.id === "grove-memory"));
  assert(
    mcp.data.some(
      (server) =>
        server.name === "grove" && server.status.status === "connected",
    ),
  );
} finally {
  child.kill("SIGTERM");
}
