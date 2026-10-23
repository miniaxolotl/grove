import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setTimeout, clearTimeout } from "node:timers";

export const exec = promisify(execFile);
export const key = "grove-isolated-fixture-key";
export const memoryId = "00000000-0000-4000-a000-000000000002";
export const tools = ["forget", "memories", "recall", "remember"];
export const calls = () => [
  ["recall", {}],
  ["memories", {}],
  [
    "remember",
    {
      operationId: randomUUID(),
      content: "Synthetic isolated agent acceptance.",
    },
  ],
  [
    "forget",
    {
      operationId: randomUUID(),
      items: [{ id: memoryId, expectedVersion: 1 }],
    },
  ],
];

export async function hostEnvironment(directory, bin) {
  for (const name of [".config", "cache", "data", "state", "temp"])
    await mkdir(join(directory, name), { recursive: true });
  return {
    HOME: directory,
    XDG_CONFIG_HOME: join(directory, ".config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    XDG_DATA_HOME: join(directory, "data"),
    XDG_STATE_HOME: join(directory, "state"),
    TMPDIR: join(directory, "temp"),
    CLAUDE_CONFIG_DIR: join(directory, "claude"),
    CODEX_HOME: join(directory, "codex"),
    // Shell hooks need system commands, but no ambient version-manager/credential environment.
    PATH: [bin, "/usr/bin", "/bin"].join(delimiter),
    DO_NOT_TRACK: "1",
    GROVE_TELEMETRY: "0",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

export async function fixtureCredentials(env, agent, origin, paused = false) {
  // Use normal persisted state: Codex deliberately filters ambient GROVE_* variables.
  const directory = join(env.XDG_CONFIG_HOME, "grove");
  const accountId = "00000000-0000-4000-a000-000000000001";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, "config.json"),
    JSON.stringify({
      origin,
      origins: { [agent]: origin },
      accounts: { [origin]: { [agent]: accountId } },
      paused,
    }),
    { mode: 0o600 },
  );
  const hash = createHash("sha256")
    .update(`${origin}|${agent}|${accountId}`)
    .digest("hex");
  await writeFile(
    join(directory, `credentials-${hash}.json`),
    JSON.stringify({
      agent,
      origin,
      accountId,
      key,
    }),
    { mode: 0o600 },
  );
}

export async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGTERM");
  let timer;
  await Promise.race([
    closed,
    new Promise((resolve) => {
      timer = setTimeout(resolve, 3000);
    }),
  ]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await closed;
  }
}

export function rpcClient(binary, env, cwd) {
  const child = spawn(binary, ["app-server", "--stdio"], {
    env,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  let id = 0;
  const pending = new Map();
  const notifications = [];
  const reader = createInterface({ input: child.stdout });
  const fail = () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Native app-server disconnected"));
    }
    pending.clear();
  };
  reader.on("line", (line) => {
    try {
      assert(line.length < 1024 * 1024, "Bounded app-server response");
      const message = JSON.parse(line);
      if (pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        if (message.error)
          reject(new Error("Native app-server request rejected"));
        else resolve(message.result);
      } else if (
        message.method === "mcpServer/startupStatus/updated" &&
        notifications.length < 100
      ) {
        notifications.push(message.params);
      }
    } catch {
      fail();
    }
  });
  child.once("error", fail);
  child.once("close", fail);
  return {
    notifications,
    notify(method) {
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method, params: {} }) + "\n",
      );
    },
    request(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Native request timed out: ${method}`));
        }, 30000);
        pending.set(requestId, { resolve, reject, timer });
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) +
            "\n",
        );
      });
    },
    async close() {
      await stopChild(child);
      reader.close();
      fail();
    },
  };
}

export async function startFixture() {
  const requests = [];
  const modelCalls = calls();
  let modelStep = 0;
  let failure;
  const server = createServer(async (request, response) => {
    try {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        assert(raw.length < 1024 * 1024, "Bounded fixture input");
      }
      const body = raw ? JSON.parse(raw) : {};
      const path = request.url.split("?")[0];
      if (
        [
          "/v1/me",
          "/v1/projects",
          "/v1/recall",
          "/v1/memories",
          "/v1/memories/search",
          "/v1/memories/delete",
        ].includes(path)
      ) {
        assert.equal(request.headers.authorization, `Bearer ${key}`);
        requests.push({ path, body });
        const data =
          path === "/v1/me"
            ? {
                accountId: memoryId,
                apiVersion: 1,
                capabilities: ["memory:read", "memory:write"],
                recallEnabled: true,
                captureEnabled: true,
              }
            : path === "/v1/projects"
              ? []
              : path === "/v1/recall"
                ? { items: [], mode: "profile", contentVersion: 1 }
                : path === "/v1/memories/search"
                  ? { items: [], nextCursor: null }
                  : path === "/v1/memories/delete"
                    ? { results: [] }
                    : {
                        ...body,
                        id: memoryId,
                        version: 1,
                        indexing: "pending",
                      };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ success: true, data }));
        return;
      }
      if (path === "/v1/messages") {
        const nativeTools = body.tools ?? [];
        const call = nativeTools.some((tool) => tool.name?.includes("grove"))
          ? modelCalls[modelStep++]
          : undefined;
        const name =
          call &&
          nativeTools.find((tool) => tool.name?.endsWith(`__${call[0]}`))?.name;
        if (call) assert(name, "Native host exposes the packaged Grove tool");
        const content = call
          ? {
              type: "tool_use",
              id: `toolu_fixture_${modelStep}`,
              name,
              input: call[1],
            }
          : { type: "text", text: "Isolated native fixture complete." };
        const message = {
          id: `msg_${randomUUID()}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [content],
          stop_reason: call ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
        };
        if (!body.stream) {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(message));
          return;
        }
        response.setHeader("Content-Type", "text/event-stream");
        const emit = (type, data) =>
          response.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
          );
        emit("message_start", {
          message: { ...message, content: [], stop_reason: null },
        });
        emit("content_block_start", {
          index: 0,
          content_block: call
            ? { ...content, input: {} }
            : { type: "text", text: "" },
        });
        emit("content_block_delta", {
          index: 0,
          delta: call
            ? {
                type: "input_json_delta",
                partial_json: JSON.stringify(call[1]),
              }
            : { type: "text_delta", text: content.text },
        });
        emit("content_block_stop", { index: 0 });
        emit("message_delta", {
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: 20 },
        });
        emit("message_stop", {});
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        path.includes("count_tokens") ? '{"input_tokens":100}' : "{}",
      );
    } catch (error) {
      failure = error;
      response.writeHead(500).end("Fixture assertion failed");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    assertHealthy() {
      if (failure) throw failure;
    },
    assertTools(agent) {
      if (failure) throw failure;
      for (const path of [
        "/v1/recall",
        "/v1/memories/search",
        "/v1/memories",
        "/v1/memories/delete",
      ])
        assert(
          requests.some((entry) => entry.path === path),
          `Tool reached ${path}`,
        );
      assert.equal(
        requests.find((entry) => entry.path === "/v1/memories").body.source
          .agent,
        agent,
      );
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
