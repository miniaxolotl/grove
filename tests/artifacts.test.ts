import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
let directory: string;
let origin: string;
let server: ReturnType<typeof createServer>;
const requests: { path: string; body: Record<string, unknown> }[] = [];
const accountId = "00000000-0000-4000-a000-000000000001";
const packages = [
  "api",
  "mcp",
  "grove-opencode-plugin",
  "grove-claude-plugin",
  "grove-codex-plugin",
];
const paths = new Map<string, string>();

before(async () => {
  const temporary = process.env.CI ? tmpdir() : "/tmp/opencode";
  await mkdir(temporary, { recursive: true });
  directory = await mkdtemp(join(temporary, "grove-artifacts-"));
  for (const name of packages) {
    const target = join(directory, name);
    await mkdir(target);
    await exec("pnpm", ["pack", "--pack-destination", target], {
      cwd: join(root, "packages", name),
      maxBuffer: 1024 * 1024,
    });
    const file = (await readdir(target)).find((entry) =>
      entry.endsWith(".tgz"),
    )!;
    await exec("tar", ["-xzf", join(target, file), "-C", target]);
    paths.set(name, join(target, "package"));
  }
  server = createServer(async (request, response) => {
    const body: Buffer[] = [];
    for await (const chunk of request) body.push(Buffer.from(chunk));
    const input = body.length ? JSON.parse(Buffer.concat(body).toString()) : {};
    requests.push({ path: request.url!, body: input });
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== "Bearer artifact-test-key") {
      response.writeHead(401).end(
        JSON.stringify({
          success: false,
          error: { code: "unauthorized", message: "Sign in" },
        }),
      );
      return;
    }
    const data =
      request.url === "/v1/me"
        ? {
            accountId,
            capabilities: ["memory:read", "memory:write"],
            apiVersion: 1,
            recallEnabled: true,
            captureEnabled: false,
          }
        : request.url === "/v1/projects"
          ? []
          : request.url === "/v1/recall"
            ? { items: [], mode: "profile", contentVersion: 1 }
            : request.url === "/v1/memories/search"
              ? { items: [], nextCursor: null }
              : request.url === "/v1/memories/delete"
                ? { results: [] }
                : {
                    ...input,
                    id: "00000000-0000-4000-a000-000000000002",
                    version: 1,
                    indexing: "pending",
                  };
    response.end(JSON.stringify({ success: true, data }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

test("each packed marketplace artifact contains prebuilt executables and declared manifests", async () => {
  for (const [name, path] of paths) {
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    assert(
      !Object.values(pkg.dependencies ?? {}).some((version) =>
        String(version).includes("workspace:"),
      ),
    );
    if (name === "api") {
      await stat(join(path, "dist/server.js"));
      await stat(join(path, "dist/worker.js"));
      continue;
    }
    const executable = join(path, "dist/cli.js");
    assert(
      (await readFile(executable, "utf8")).startsWith("#!/usr/bin/env node"),
    );
    const output = await exec(process.execPath, [executable], {
      cwd: directory,
      env: { ...process.env, GROVE_CONFIG_HOME: join(directory, "empty") },
    });
    assert.match(output.stdout, /grove init/);
    assert.doesNotMatch(output.stdout, /listening/);
    if (name.startsWith("grove-") && name !== "grove-opencode-plugin") {
      const manifest = JSON.parse(
        await readFile(
          join(
            path,
            name === "grove-claude-plugin"
              ? ".claude-plugin/plugin.json"
              : "plugin.json",
          ),
          "utf8",
        ),
      );
      assert.equal(manifest.version, pkg.version);
      await stat(join(path, "hooks/hooks.json"));
      await stat(join(path, "skills/setup/SKILL.md"));
      const mcp = JSON.parse(
        await readFile(
          join(path, name === "grove-claude-plugin" ? ".mcp.json" : "mcp.json"),
          "utf8",
        ),
      );
      assert(mcp.mcpServers.grove.args[0].endsWith("/dist/cli.js"));
    }
  }
});

test("packed stdio MCP authenticates explicit saves, records provenance and blocks private automatic saves", async () => {
  for (const name of [
    "mcp",
    "grove-claude-plugin",
    "grove-codex-plugin",
    "grove-opencode-plugin",
  ]) {
    const client = new Client({ name: "packed-client", version: "1" });
    const agent =
      name === "mcp"
        ? "cli"
        : name.replace("grove-", "").replace("-plugin", "");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(paths.get(name)!, "dist/cli.js"),
        "mcp",
        "--stdio",
        "--client",
        agent,
      ],
      cwd: directory,
      env: {
        PATH: process.env.PATH!,
        GROVE_API_URL: origin,
        GROVE_API_KEY: "artifact-test-key",
        GROVE_CONFIG_HOME: join(directory, "credentials"),
        GROVE_PRIVATE: "1",
      },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      assert.deepEqual(
        (await client.listTools()).tools.map((t) => t.name),
        ["remember", "recall", "memories", "forget"],
      );
      const automatic = await client.callTool({
        name: "remember",
        arguments: {
          operationId: "00000000-0000-4000-a000-000000000004",
          content: "Private automatic memory must never leave this process.",
          capture: "automatic",
        },
      });
      assert.equal(automatic.isError, true);
      assert.match(JSON.stringify(automatic), /capture_paused/);
      const saved = await client.callTool({
        name: "remember",
        arguments: {
          operationId: "00000000-0000-4000-a000-000000000003",
          content: "A packed artifact saved this fact.",
        },
      });
      assert.notEqual(saved.isError, true);
      assert.match(JSON.stringify(saved), /pending/);
      assert.equal(
        (requests.at(-1)!.body.source as { agent: string }).agent,
        agent,
      );
    } finally {
      await client.close();
    }
  }
  assert.equal(requests.filter((r) => r.path === "/v1/memories").length, 4);
});

test("setup is repeatable, preserves JSONC and other plugins, credentials are private, uninstall is targeted", async () => {
  const executable = join(paths.get("mcp")!, "dist/cli.js");
  const configHome = join(directory, "config");
  const opencode = join(configHome, "opencode");
  await mkdir(opencode, { recursive: true });
  await writeFile(
    join(opencode, "opencode.jsonc"),
    '{\n// keep my comment\n"theme":"custom","plugins":["other-plugin"],"mcp":{"other":{"type":"remote","url":"https://example.com/mcp"}}\n}',
  );
  const env = {
    ...process.env,
    GROVE_API_URL: origin,
    GROVE_API_KEY: "artifact-test-key",
    GROVE_CONFIG_HOME: join(directory, "store"),
    XDG_CONFIG_HOME: configHome,
  };
  // Feed a real scoped credential over stdin; neither plugin config nor process args hold it.
  for (let i = 0; i < 2; i++)
    await new Promise<void>((done, fail) => {
      const child = execFile(
        process.execPath,
        [executable, "init", "--client", "opencode", "--key-stdin"],
        { cwd: directory, env },
        (error) => (error ? fail(error) : done()),
      );
      child.stdin!.end("artifact-test-key\n");
    });
  const config = await readFile(join(opencode, "opencode.jsonc"), "utf8");
  assert.match(config, /keep my comment/);
  assert.match(config, /other-plugin/);
  assert.match(config, /"theme":"custom"/);
  assert.equal(config.match(/@miniaxolotl\/grove-opencode-plugin/g)?.length, 1);
  assert.doesNotMatch(config, /artifact-test-key/);
  const files = await readdir(env.GROVE_CONFIG_HOME);
  const credential = files.find((file) => file.startsWith("credentials-"))!;
  assert.equal(
    (await stat(join(env.GROVE_CONFIG_HOME, credential))).mode & 0o777,
    0o600,
  );
  await exec(
    process.execPath,
    [executable, "uninstall", "--client", "opencode"],
    { env },
  );
  const removed = await readFile(join(opencode, "opencode.jsonc"), "utf8");
  assert.doesNotMatch(removed, /grove-opencode-plugin/);
  assert.match(removed, /other-plugin/);
  assert.match(removed, /keep my comment/);
  const connected = await exec(
    process.execPath,
    [executable, "status", "--client", "opencode", "--json"],
    { env },
  );
  assert.equal(JSON.parse(connected.stdout).status, "connected");
  await assert.rejects(
    exec(process.execPath, [executable, "status", "--json"], {
      env: { ...env, GROVE_API_KEY: "wrong" },
    }),
    (error: unknown) => {
      assert.equal(
        JSON.parse((error as { stdout: string }).stdout).code,
        "unauthorized",
      );
      return true;
    },
  );
});
