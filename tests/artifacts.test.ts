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
import { createHash, randomUUID } from "node:crypto";
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
    await exec(
      process.execPath,
      [
        join(root, "scripts/release/pack.mjs"),
        join(root, "packages", name),
        target,
      ],
      {
        cwd: root,
        maxBuffer: 1024 * 1024,
      },
    );
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

test("packed doctor separates local and probe evidence without inspecting the live host", async () => {
  const home = await mkdtemp(join(directory, "doctor-"));
  const bin = join(home, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "opencode"), "#!/bin/sh\nexit 91\n", {
    mode: 0o700,
  });
  const executable = join(paths.get("mcp")!, "dist/cli.js");
  const env = {
    PATH: bin,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    GROVE_CONFIG_HOME: join(home, "grove"),
    GROVE_API_URL: origin,
    GROVE_API_KEY: "artifact-test-key",
    DO_NOT_TRACK: "1",
  };
  const args = [executable, "doctor", "--client", "opencode", "--json"];
  const before = requests.length;
  const local = JSON.parse(
    (await exec(process.execPath, args, { env })).stdout,
  );
  assert.equal(local.schemaVersion, 1);
  assert.equal(local.hostVerified, false);
  assert.equal(
    local.checks.find((check: { id: string }) => check.id === "host").status,
    "unknown",
  );
  assert.equal(
    local.checks.find((check: { id: string }) => check.id === "api").status,
    "skipped",
  );
  assert.equal(requests.length, before, "Default diagnosis is offline");
  const normalized = JSON.parse(
    (
      await exec(process.execPath, args, {
        env: { ...env, GROVE_API_URL: `${origin}/` },
      })
    ).stdout,
  );
  assert.equal(
    normalized.status,
    "ok",
    "Environment credentials are paired with the canonical API origin",
  );
  assert.deepEqual(
    await readdir(home),
    ["bin"],
    "No configuration, credentials or telemetry written",
  );
  const probed = JSON.parse(
    (await exec(process.execPath, [...args, "--probe"], { env })).stdout,
  );
  assert.equal(
    probed.checks.find((check: { id: string }) => check.id === "bridge").status,
    "passed",
  );
  assert.equal(
    probed.checks.find((check: { id: string }) => check.id === "api").status,
    "passed",
  );
  assert.equal(
    probed.hostVerified,
    false,
    "A new bridge does not prove live host readiness",
  );
  assert.deepEqual(
    requests.slice(before).map((request) => request.path),
    ["/v1/me"],
  );
  assert.doesNotMatch(JSON.stringify(probed), /artifact-test-key/);
  assert.deepEqual(await readdir(home), ["bin"]);
  await assert.rejects(
    exec(process.execPath, args, {
      env: { ...env, PATH: join(home, "absent") },
    }),
    (error: unknown) => {
      const report = JSON.parse((error as { stdout: string }).stdout);
      assert.equal(report.status, "attention");
      assert.equal(
        report.checks.find((check: { id: string }) => check.id === "client")
          .code,
        "client_missing",
      );
      return true;
    },
  );
});

test("doctor rejects malformed, unsupported or unapproved API access without exposing upstream details", async () => {
  const home = await mkdtemp(join(directory, "doctor-response-"));
  const bin = join(home, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "codex"), "#!/bin/sh\nexit 92\n", { mode: 0o700 });
  let data: unknown;
  const upstream = createServer((_request, response) =>
    response
      .setHeader("Content-Type", "application/json")
      .end(JSON.stringify({ success: true, data })),
  );
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  const address = upstream.address();
  assert(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const env = {
    PATH: bin,
    HOME: home,
    GROVE_CONFIG_HOME: join(home, "grove"),
    GROVE_API_URL: endpoint,
    GROVE_API_KEY: "private-doctor-canary",
    DO_NOT_TRACK: "1",
  };
  try {
    for (const [value, code] of [
      [null, "invalid_response"],
      [{ accountId, capabilities: [], apiVersion: 1 }, "awaiting_grant"],
      [
        { accountId, capabilities: ["memory:read"], apiVersion: 2 },
        "api_version_unsupported",
      ],
    ] as const) {
      data = value;
      await assert.rejects(
        exec(
          process.execPath,
          [
            join(paths.get("mcp")!, "dist/cli.js"),
            "doctor",
            "--client",
            "codex",
            "--json",
            "--probe",
          ],
          { env },
        ),
        (error: unknown) => {
          const stdout = (error as { stdout: string }).stdout;
          const report = JSON.parse(stdout);
          assert.equal(
            report.checks.find((check: { id: string }) => check.id === "api")
              .code,
            code,
          );
          assert.equal(report.hostVerified, false);
          assert.doesNotMatch(stdout, /private-doctor-canary/);
          return true;
        },
      );
    }
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
  }
});

test("a running packed bridge picks up first login and an explicit origin switch", async () => {
  const home = await mkdtemp(join(directory, "live-login-"));
  const executable = join(paths.get("mcp")!, "dist/cli.js");
  const env = {
    ...process.env,
    GROVE_CONFIG_HOME: home,
    GROVE_API_URL: "",
    GROVE_API_KEY: "",
  };
  const login = (url: string, key: string) =>
    new Promise<void>((done, fail) => {
      const child = execFile(
        process.execPath,
        [
          executable,
          "login",
          "--client",
          "opencode",
          "--url",
          url,
          "--key-stdin",
        ],
        { env },
        (error) => (error ? fail(error) : done()),
      );
      child.stdin!.end(key);
    });
  let recalls = 0;
  const other = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer other-origin-key");
    if (request.url === "/v1/recall") recalls++;
    response.setHeader("Content-Type", "application/json").end(
      JSON.stringify({
        success: true,
        data:
          request.url === "/v1/me"
            ? { accountId, capabilities: ["memory:read"] }
            : { items: [], mode: "profile", contentVersion: 0 },
      }),
    );
  });
  await new Promise<void>((done) => other.listen(0, "127.0.0.1", done));
  const client = new Client({ name: "live-login-fixture", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [executable, "mcp", "--stdio", "--client", "opencode"],
        env: { PATH: process.env.PATH!, GROVE_CONFIG_HOME: home },
        stderr: "pipe",
      }),
    );
    assert.match(
      JSON.stringify(await client.callTool({ name: "recall", arguments: {} })),
      /not_configured/,
    );
    await login(origin, "artifact-test-key");
    assert.notEqual(
      (await client.callTool({ name: "recall", arguments: {} })).isError,
      true,
    );
    const oldRequests = requests.length;
    await login(
      `http://127.0.0.1:${(other.address() as { port: number }).port}`,
      "other-origin-key",
    );
    assert.notEqual(
      (await client.callTool({ name: "recall", arguments: {} })).isError,
      true,
    );
    assert.equal(recalls, 1);
    assert.equal(
      requests.length,
      oldRequests,
      "The running bridge stopped using the old origin",
    );
  } finally {
    await client.close();
    await new Promise<void>((done) => other.close(() => done()));
  }
});

test(
  "packed Cloud connect completes PKCE, redirects the same browser to approval and resumes saved credentials",
  { timeout: 30000 },
  async () => {
    const home = await mkdtemp(join(directory, "connect-"));
    const bin = join(home, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "opencode"), "#!/bin/sh\necho '2.0.fixture'\n", {
      mode: 0o700,
    });
    const executable = join(paths.get("mcp")!, "dist/cli.js");
    const id = randomUUID();
    const connectionId = randomUUID();
    const projectId = randomUUID();
    let endpoint = "";
    let approved = false;
    let authorization: URL | undefined;
    let registrations = 0;
    let polls = 0;
    const attempt = () => ({
      id,
      connectionId,
      clientId: "fixture-public-client",
      agent: "opencode",
      status: approved ? "approved" : "pending",
      project: { name: "Fixture", identity: "git:example.test/fixture/repo" },
      projectId: approved ? projectId : null,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      grant: {
        name: "OpenCode · Fixture",
        capabilities: ["memory:read", "memory:write"],
        personal: true,
        allProjects: false,
        projectIds: approved ? [projectId] : [],
      },
    });
    const oauth = createServer(async (request, response) => {
      const url = new URL(request.url!, endpoint);
      let raw = "";
      for await (const chunk of request) raw += chunk;
      response.setHeader("Content-Type", "application/json");
      const reply = (data: unknown) => response.end(JSON.stringify(data));
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return reply({
          resource: `${endpoint}/mcp`,
          authorization_servers: [endpoint],
        });
      if (url.pathname.startsWith("/.well-known/"))
        return reply({
          issuer: endpoint,
          authorization_endpoint: `${endpoint}/authorize`,
          token_endpoint: `${endpoint}/token`,
          registration_endpoint: `${endpoint}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      if (url.pathname === "/register") {
        registrations++;
        return reply({
          ...JSON.parse(raw),
          client_id: "fixture-public-client",
        });
      }
      if (url.pathname === "/authorize") {
        authorization = url;
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.equal(url.searchParams.get("resource"), `${endpoint}/mcp`);
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "fixture-code");
        callback.searchParams.set("state", url.searchParams.get("state")!);
        response.writeHead(302, { Location: callback.href }).end();
        return;
      }
      if (url.pathname === "/token") {
        const body = new URLSearchParams(raw);
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("code"), "fixture-code");
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier")!)
            .digest("base64url"),
          authorization!.searchParams.get("code_challenge"),
        );
        return reply({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.pathname.startsWith("/v1/")) {
        assert.equal(request.headers.authorization, "Bearer fixture-access");
        if (url.pathname === "/v1/me")
          return reply({
            success: true,
            data: {
              accountId,
              connectionId,
              capabilities: approved ? ["memory:read", "memory:write"] : [],
              grant: approved ? attempt().grant : null,
            },
          });
        if (url.pathname === "/v1/connect") {
          assert.deepEqual(JSON.parse(raw), {
            agent: "opencode",
            project: attempt().project,
          });
          return reply({
            success: true,
            data: {
              ...attempt(),
              approvalUrl: `${endpoint}/app/connect/${id}`,
            },
          });
        }
        if (url.pathname === `/v1/connect/${id}`) {
          polls++;
          return reply({ success: true, data: attempt() });
        }
        if (url.pathname === "/v1/recall") {
          assert.equal(approved, true);
          assert.equal(JSON.parse(raw).projectId, projectId);
          return reply({
            success: true,
            data: { items: [], mode: "profile", contentVersion: 0 },
          });
        }
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((done) => oauth.listen(0, "127.0.0.1", done));
    endpoint = `http://127.0.0.1:${(oauth.address() as { port: number }).port}`;
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GROVE_CONFIG_HOME: join(home, "store"),
      XDG_CONFIG_HOME: join(home, "config"),
      GROVE_API_URL: "",
      GROVE_API_KEY: "",
      GROVE_PROJECT_IDENTITY: "git:example.test/fixture/repo",
      GROVE_PROJECT_NAME: "Fixture",
    };
    const args = [
      executable,
      "connect",
      "opencode",
      "--url",
      endpoint,
      "--no-browser",
      "--json",
    ];
    let child: ReturnType<typeof execFile> | undefined;
    const launch = () => {
      let browser!: (url: string) => void;
      const browserUrl = new Promise<string>((done) => {
        browser = done;
      });
      const finished = new Promise<{ stdout: string; stderr: string }>(
        (done, fail) => {
          child = execFile(
            process.execPath,
            args,
            { env, cwd: home, timeout: 20000 },
            (error, stdout, stderr) =>
              error
                ? fail(Object.assign(error, { stdout, stderr }))
                : done({ stdout, stderr }),
          );
          let stderr = "";
          child.stderr!.on("data", (chunk) => {
            stderr += chunk;
            const found = stderr.match(/Continue in your browser: (\S+)/);
            if (found) browser(found[1]);
          });
        },
      );
      void finished.catch(() => {});
      return {
        finished,
        browserUrl: Promise.race([
          browserUrl,
          finished.then(() => {
            throw new Error("CLI exited before authorization");
          }),
        ]),
      };
    };
    try {
      const first = launch();
      const url = await first.browserUrl;
      const consent = await fetch(url, { redirect: "manual" });
      const callback = consent.headers.get("location")!;
      const bad = new URL(callback);
      bad.searchParams.set("state", "wrong");
      assert.equal((await fetch(bad)).status, 400);
      const continued = await fetch(callback, { redirect: "manual" });
      assert.equal(continued.status, 303);
      assert.equal(
        continued.headers.get("location"),
        `${endpoint}/app/connect/${id}`,
      );
      assert.equal(approved, false);
      child!.kill("SIGTERM");
      await assert.rejects(first.finished);
      const pending = launch();
      assert.equal(
        await pending.browserUrl,
        `${endpoint}/app/connect/${id}`,
        "Interrupted setup reuses credentials and the pending approval",
      );
      approved = true;
      const result = await pending.finished;
      assert.equal(JSON.parse(result.stdout).status, "connected");
      assert.equal(JSON.parse(result.stdout).projectId, projectId);
      assert.equal(JSON.parse(result.stdout).restartRequired, false);
      assert.equal(JSON.parse(result.stdout).hostVerified, false);
      assert.match(JSON.parse(result.stdout).nextStep, /automatically/);
      assert.equal(JSON.parse(result.stdout).recallVerified, true);
      assert(polls > 0);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /fixture-access|fixture-refresh/,
      );
      assert.match(
        await readFile(
          join(env.XDG_CONFIG_HOME, "opencode/opencode.jsonc"),
          "utf8",
        ),
        /grove-opencode-plugin/,
      );
      const configPath = join(env.XDG_CONFIG_HOME, "opencode/opencode.jsonc");
      const inode = (await stat(configPath)).ino;
      const resumed = await exec(process.execPath, args, { env, cwd: home });
      assert.equal(JSON.parse(resumed.stdout).status, "connected");
      assert.doesNotMatch(resumed.stderr, /Continue in your browser/);
      assert.equal(registrations, 1);
      const configSource = await readFile(configPath, "utf8");
      assert.equal(
        (await stat(configPath)).ino,
        inode,
        "Ready integration setup does not rewrite configuration",
      );
      const detected = await exec(
        process.execPath,
        args.filter((arg) => arg !== "opencode"),
        { env: { ...env, PATH: bin }, cwd: home },
      );
      assert.equal(JSON.parse(detected.stdout).agent, "opencode");
      await writeFile(configPath, "{ invalid JSON");
      await assert.rejects(
        exec(process.execPath, args, { env, cwd: home }),
        (error: unknown) => {
          assert.equal(
            JSON.parse((error as { stdout: string }).stdout).code,
            "invalid_config",
          );
          return true;
        },
      );
      await writeFile(configPath, configSource);
      assert.equal(
        JSON.parse(
          (await exec(process.execPath, args, { env, cwd: home })).stdout,
        ).status,
        "connected",
      );
      assert.equal(
        registrations,
        1,
        "Installer failure does not require sign-in or approval again",
      );
      await assert.rejects(
        exec(process.execPath, [executable, "connect", "codex", "--json"], {
          cwd: home,
          env: { ...env, PATH: bin },
        }),
        (error: unknown) => {
          assert.equal(
            JSON.parse((error as { stdout: string }).stdout).code,
            "client_missing",
          );
          return true;
        },
      );
    } finally {
      child?.kill();
      oauth.closeAllConnections();
      await new Promise<void>((done) => oauth.close(() => done()));
    }
  },
);
