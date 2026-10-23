import assert from "node:assert/strict";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { packArtifact } from "../release/pack.mjs";
import {
  calls,
  exec,
  fixtureCredentials,
  hostEnvironment,
  rpcClient,
  startFixture,
  tools,
} from "./host-fixture.mjs";

assert(
  process.platform === "linux" && process.arch === "x64",
  "This qualification runner currently supports Linux x64 only",
);
const root = resolve(import.meta.dirname, "../..");
const base = process.env.CI ? tmpdir() : "/tmp/opencode";
await mkdir(base, { recursive: true });
// Spaces exercise native manifest substitution and shell-hook quoting.
const directory = await mkdtemp(join(base, "grove agents-"));
const bin = join(directory, "bin");
await mkdir(bin);
await symlink(process.execPath, join(bin, "node"));
const runtime = join(directory, "runtimes");
await mkdir(runtime);
for (const name of ["package.json", "package-lock.json"])
  await copyFile(join(import.meta.dirname, "hosts", name), join(runtime, name));
const installEnv = await hostEnvironment(
  join(directory, "install-home"),
  dirname(process.execPath),
);
const started = performance.now();
await exec(
  "npm",
  ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", runtime],
  {
    cwd: runtime,
    env: {
      ...installEnv,
      npm_config_cache: join(directory, "npm-cache"),
      npm_config_userconfig: "/dev/null",
    },
    timeout: 180000,
    maxBuffer: 1024 * 1024,
  },
);
const binaries = {
  opencode:
    process.env.OPENCODE_TEST_BIN ||
    join(runtime, "node_modules/@opencode/cli-linux-x64-baseline/bin/opencode"),
  claude:
    process.env.CLAUDE_TEST_BIN ||
    join(runtime, "node_modules/@anthropic-ai/claude-code-linux-x64/claude"),
  codex:
    process.env.CODEX_TEST_BIN ||
    join(
      runtime,
      "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
    ),
};
const pins = JSON.parse(
  await readFile(join(runtime, "package.json"), "utf8"),
).dependencies;
for (const [agent, binary] of Object.entries(binaries)) {
  assert(isAbsolute(binary), "Host binary overrides must be absolute paths");
  const version = await exec(binary, ["--version"], {
    env: installEnv,
    cwd: directory,
    timeout: 10000,
  });
  const expected =
    pins[
      agent === "opencode"
        ? "@opencode/cli"
        : agent === "claude"
          ? "@anthropic-ai/claude-code"
          : "@openai/codex"
    ];
  assert.equal(
    version.stdout.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0],
    expected,
    "Qualified host version matches the integrity-pinned fixture",
  );
}
const packages = {};
for (const agent of ["claude", "codex"]) {
  const target = join(directory, "artifacts", agent);
  await mkdir(target, { recursive: true });
  const archive = packArtifact(
    join(root, `packages/grove-${agent}-plugin`),
    target,
  );
  await exec("tar", ["-xzf", archive, "-C", target], { timeout: 30000 });
  packages[agent] = join(target, "package");
}
const results = [];
const opencode = await exec(
  process.execPath,
  [join(import.meta.dirname, "opencode-host.mjs")],
  {
    cwd: root,
    env: {
      ...installEnv,
      PATH: process.env.PATH,
      OPENCODE_TEST_BIN: binaries.opencode,
    },
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  },
);
assert(
  JSON.parse(opencode.stdout).mcp.data.some(
    (server) => server.name === "grove" && server.status.status === "connected",
  ),
);
results.push({
  agent: "opencode",
  version: pins["@opencode/cli"],
  noNodePath: true,
  connected: true,
});

async function claude() {
  const env = await hostEnvironment(join(directory, "claude-home"), bin);
  const fixture = await startFixture();
  let installed = false;
  try {
    await fixtureCredentials(env, "claude", fixture.origin);
    await exec(
      binaries.claude,
      ["plugin", "validate", packages.claude, "--strict"],
      { cwd: directory, env, timeout: 30000 },
    );
    const market = join(directory, "claude-marketplace");
    await mkdir(join(market, ".claude-plugin"), { recursive: true });
    await cp(packages.claude, join(market, "plugins/grove"), {
      recursive: true,
    });
    await writeFile(
      join(market, ".claude-plugin/marketplace.json"),
      JSON.stringify({
        name: "grove-fixture",
        owner: { name: "Grove fixtures" },
        plugins: [{ name: "grove", source: "./plugins/grove" }],
      }),
    );
    for (const command of [
      ["plugin", "marketplace", "add", market],
      ["plugin", "install", "grove@grove-fixture", "--scope", "user"],
    ])
      await exec(binaries.claude, command, {
        cwd: directory,
        env,
        timeout: 30000,
      });
    installed = true;
    const list = JSON.parse(
      (
        await exec(binaries.claude, ["plugin", "list", "--json"], {
          cwd: directory,
          env,
          timeout: 30000,
        })
      ).stdout,
    );
    assert(
      list.some(
        (plugin) => plugin.id === "grove@grove-fixture" && plugin.enabled,
      ),
    );
    const args = [];
    const health = await exec(binaries.claude, [...args, "mcp", "list"], {
      cwd: directory,
      env,
      timeout: 30000,
    });
    assert.match(health.stdout, /plugin:grove:grove.*Connected/);
    const result = await exec(
      binaries.claude,
      [
        ...args,
        "-p",
        "Exercise only the synthetic Grove fixtures.",
        "--tools",
        "",
        "--allowedTools",
        "mcp__plugin_grove_grove__*",
        "--model",
        "claude-sonnet-4-6",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-hook-events",
        "--no-session-persistence",
      ],
      {
        cwd: directory,
        env: {
          ...env,
          ANTHROPIC_BASE_URL: fixture.origin,
          ANTHROPIC_API_KEY: "synthetic-model-key",
        },
        timeout: 90000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const init = events.find((event) => event.subtype === "init");
    for (const skill of ["grove:memory", "grove:setup"])
      assert(init.skills.includes(skill));
    assert(
      events.some(
        (event) =>
          event.subtype === "hook_response" &&
          event.hook_event === "SessionStart" &&
          event.exit_code === 0,
      ),
    );
    fixture.assertTools("claude");
    const noNode = join(directory, "empty-bin");
    await mkdir(noNode, { recursive: true });
    const failed = await exec(binaries.claude, [...args, "mcp", "list"], {
      cwd: directory,
      env: { ...env, PATH: noNode },
      timeout: 30000,
    });
    assert.match(failed.stdout, /Failed to connect/);
    return {
      agent: "claude",
      version: pins["@anthropic-ai/claude-code"],
      tools,
      skills: true,
      hook: true,
      missingNodeDetected: true,
    };
  } finally {
    try {
      if (installed) {
        await exec(
          binaries.claude,
          ["plugin", "uninstall", "grove@grove-fixture", "--scope", "user"],
          { cwd: directory, env, timeout: 30000 },
        );
        const list = JSON.parse(
          (
            await exec(binaries.claude, ["plugin", "list", "--json"], {
              cwd: directory,
              env,
              timeout: 30000,
            })
          ).stdout,
        );
        assert(!list.some((plugin) => plugin.id === "grove@grove-fixture"));
      }
    } finally {
      await fixture.close();
    }
  }
}

async function codex() {
  const env = await hostEnvironment(join(directory, "codex-home"), bin);
  const fixture = await startFixture();
  let client;
  try {
    await mkdir(env.CODEX_HOME, { recursive: true });
    await fixtureCredentials(env, "codex", fixture.origin, true);
    const market = join(directory, "marketplace");
    await mkdir(join(market, ".agents/plugins"), { recursive: true });
    await cp(packages.codex, join(market, "plugins/grove"), {
      recursive: true,
    });
    await writeFile(
      join(market, ".agents/plugins/marketplace.json"),
      JSON.stringify({
        name: "grove-fixture",
        plugins: [
          {
            name: "grove",
            source: { source: "local", path: "./plugins/grove" },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: "Productivity",
          },
        ],
      }),
    );
    for (const args of [
      ["plugin", "marketplace", "add", market],
      ["plugin", "add", "grove@grove-fixture", "--json"],
    ])
      await exec(binaries.codex, args, { cwd: directory, env, timeout: 30000 });
    const session = async (environment) => {
      client = rpcClient(binaries.codex, environment, directory);
      await client.request("initialize", {
        clientInfo: { name: "grove-host-fixture", version: "1" },
        capabilities: { experimentalApi: true },
      });
      client.notify("initialized");
      const { thread } = await client.request("thread/start", {
        cwd: directory,
        ephemeral: true,
      });
      const status = await client.request("mcpServerStatus/list", {
        threadId: thread.id,
      });
      return {
        threadId: thread.id,
        server: status.data.find((entry) => entry.name === "grove"),
      };
    };
    const { threadId, server } = await session(env);
    assert(server);
    assert.deepEqual(Object.keys(server.tools).sort(), tools);
    for (const [tool, input] of calls()) {
      const result = await client.request("mcpServer/tool/call", {
        threadId,
        server: "grove",
        tool,
        arguments: input,
      });
      assert.notEqual(result.isError, true);
    }
    const before = fixture.requests.length;
    const denied = await client.request("mcpServer/tool/call", {
      threadId,
      server: "grove",
      tool: "remember",
      arguments: {
        operationId: randomUUID(),
        content: "Do not send automatic fixture.",
        capture: "automatic",
      },
    });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /capture_paused/);
    assert.equal(fixture.requests.length, before);
    const skills = await client.request("skills/list", {
      cwds: [directory],
      forceReload: true,
    });
    const names = skills.data
      .flatMap((entry) => entry.skills)
      .filter((skill) => skill.pluginId === "grove@grove-fixture")
      .map((skill) => skill.name);
    assert(names.includes("grove:memory") && names.includes("grove:setup"));
    fixture.assertTools("codex");
    await client.close();
    const failed = await session({
      ...env,
      PATH: join(directory, "empty-bin"),
    });
    assert.equal(failed.server.runtimeStatus, "failed");
    assert.deepEqual(Object.keys(failed.server.tools), []);
    return {
      agent: "codex",
      version: pins["@openai/codex"],
      tools,
      skills: true,
      pausedAutomaticBlocked: true,
      missingNodeDetected: true,
    };
  } finally {
    try {
      if (client) await client.close();
      await exec(
        binaries.codex,
        ["plugin", "remove", "grove@grove-fixture", "--json"],
        { cwd: directory, env, timeout: 30000 },
      );
      const list = JSON.parse(
        (
          await exec(binaries.codex, ["plugin", "list", "--json"], {
            cwd: directory,
            env,
            timeout: 30000,
          })
        ).stdout,
      );
      assert(
        !list.installed.some(
          (plugin) => plugin.pluginId === "grove@grove-fixture",
        ),
      );
    } finally {
      await fixture.close();
    }
  }
}

results.push(await claude());
results.push(await codex());
console.log(
  JSON.stringify(
    { results, durationMs: Math.round(performance.now() - started), directory },
    null,
    2,
  ),
);
