#!/usr/bin/env node
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { ApiClient, type ConnectionInfo } from "@lib/integration-core";
import {
  BrowserOAuthProvider,
  configuredOrigin,
  nodeClient,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  updateConfig,
  resolveProject,
  type AgentName,
  type Credentials,
} from "@lib/integration-core/node";
import { GroveError, agentSchema } from "@lib/shared/contracts";
import { startBridge } from "./bridge.ts";
import { installIntegration, activationInstructions } from "./install.ts";
import { openBrowser } from "./browser.ts";
import { connectAgent, cloudOrigin, type LoginOptions } from "./connect.ts";
import { selectAgent } from "./select-agent.ts";
import { closeTelemetry, telemetry, type Properties } from "@lib/telemetry";
import { outcome as operationOutcome } from "@lib/telemetry/context";
import {
  setTelemetryEnabled,
  telemetryDisabled,
} from "@lib/telemetry/preference";

const help = `Grove — private memory across your agents

  grove connect [opencode|claude|codex] [--url <self-hosted origin>] [--no-browser]
  grove init --url <origin> --client opencode|claude|codex
  grove login --url <origin> --client <client> [--key-stdin | --no-browser]
  grove status [--client <client>] [--json]
  grove project [--client <client>]
  grove logout [--client <client>]
  grove pause | resume
  grove telemetry status | enable | disable
  grove uninstall --client <client>
  grove mcp --stdio [--client <client>]
  grove serve  (requires @miniaxolotl/grove-server or use Docker)

Run grove connect to choose an installed agent, create an account or sign in, and finish setup.
Credentials stay in your user configuration, never in project files.
Use GROVE_API_URL + GROVE_API_KEY for headless clients. Logs use stderr in stdio mode.`;

let observedCommand: Properties["command"];
let commandStarted = 0;
let commandFailure: unknown;

async function login(
  origin: string,
  agent: AgentName,
  keyStdin: boolean,
  noBrowser: boolean,
  options: LoginOptions = {},
) {
  if (keyStdin) {
    let key = "";
    for await (const chunk of process.stdin) {
      key += chunk;
      if (key.length > 16384)
        throw new GroveError("invalid_key", "Key too long");
    }
    key = key.trim();
    const me = await new ApiClient(
      origin,
      async () => key,
    ).request<ConnectionInfo>("/v1/me");
    await saveCredentials({ origin, agent, accountId: me.accountId, key });
    return me;
  }
  let finish!: (code: string) => void;
  let fail!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const previous = await loadCredentials(origin, agent).catch(() => undefined);
  let callbackResponse: ServerResponse | undefined;
  const callbackPort = {
    cli: 34141,
    opencode: 34142,
    claude: 34143,
    codex: 34144,
  }[agent];
  const redirectUrl = `http://127.0.0.1:${callbackPort}/callback`;
  const provider = new BrowserOAuthProvider(
    {
      origin,
      agent,
      redirectUrl,
      client:
        !options.freshClient && previous?.redirectUrl === redirectUrl
          ? previous.client
          : undefined,
    },
    async (url) => {
      openBrowser(url, noBrowser);
    },
  );
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "text/plain");
    response.setHeader("Cache-Control", "no-store");
    if (
      url.pathname !== "/callback" ||
      callbackResponse ||
      !provider.checkState(url.searchParams.get("state"))
    ) {
      response.writeHead(400).end("Invalid authorization callback");
      return;
    }
    const result = url.searchParams.get("code");
    if (!result) {
      response.writeHead(400).end("Authorization was not completed");
      fail(
        new GroveError("login_cancelled", "Authorization was not completed"),
      );
      return;
    }
    callbackResponse = response;
    if (!options.afterLogin)
      response.end("Authorization received. Return to your terminal.");
    finish(result);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new GroveError(
          "callback_busy",
          `Loopback callback port ${callbackPort} is unavailable`,
        ),
      ),
    );
    server.listen(callbackPort, "127.0.0.1", resolve);
  });
  // Mark an early callback rejection handled while discovery/registration is still running.
  void code.catch(() => {});
  console.error(
    "Create your Grove account or sign in in the browser. Setup will continue here automatically.",
  );
  const timeout = setTimeout(
    () =>
      fail(
        new GroveError(
          "login_timeout",
          "Sign-in timed out. Run the same command to try again.",
        ),
      ),
    10 * 60_000,
  );
  try {
    const authOptions = {
      serverUrl: `${origin}/mcp`,
      fetchFn: (url: string | URL, init?: RequestInit) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
    };
    if ((await auth(provider, authOptions)) === "REDIRECT")
      await auth(provider, { ...authOptions, authorizationCode: await code });
    const token = provider.data.tokens?.access_token;
    if (!token)
      throw new GroveError("login_failed", "No access token was returned");
    const me = await new ApiClient(
      origin,
      async () => token,
    ).request<ConnectionInfo>("/v1/me");
    await saveCredentials({
      ...provider.data,
      accountId: me.accountId,
    } as Credentials);
    const continuation = await options.afterLogin?.(me);
    if (callbackResponse && !callbackResponse.writableEnded) {
      if (continuation)
        callbackResponse.writeHead(303, { Location: continuation });
      await new Promise<void>((done) =>
        callbackResponse!.end(
          continuation
            ? "Continue to Grove to approve access."
            : "Access ready. Return to your terminal to finish setup.",
          done,
        ),
      );
    }
    return me;
  } finally {
    if (callbackResponse && !callbackResponse.writableEnded)
      callbackResponse.end(
        "Connection could not be completed. Return to your terminal and run grove connect again.",
      );
    clearTimeout(timeout);
    server.closeAllConnections();
    server.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      client: { type: "string", default: "cli" },
      json: { type: "boolean" },
      stdio: { type: "boolean" },
      "key-stdin": { type: "boolean" },
      "no-browser": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    console.log(
      JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return;
  }
  const command =
    positionals[0] ??
    (process.stdin.isTTY && !values.json ? "connect" : undefined);
  if (!command || values.help) {
    console.log(help);
    return;
  }
  if (command === "telemetry") {
    const action = positionals[1] ?? "status";
    if (
      !["status", "enable", "disable"].includes(action) ||
      positionals.length > 2
    )
      throw new GroveError(
        "invalid_command",
        "Use grove telemetry status | enable | disable",
      );
    if (action !== "status") setTelemetryEnabled(action === "enable");
    console.log(
      `Anonymous analytics and diagnostics: ${telemetryDisabled() ? "disabled" : "enabled"}. DO_NOT_TRACK=1 or GROVE_TELEMETRY=0 also disables collection.`,
    );
    return;
  }
  if (
    [
      "connect",
      "init",
      "login",
      "status",
      "project",
      "logout",
      "pause",
      "resume",
      "uninstall",
      "mcp",
      "serve",
    ].includes(command)
  ) {
    observedCommand = command as Properties["command"];
    commandStarted = performance.now();
  }
  if (command === "connect") {
    const selected =
      positionals[1] ??
      (values.client !== "cli"
        ? values.client
        : await selectAgent(!!process.stdin.isTTY && !values.json));
    const parsed = agentSchema.safeParse(selected);
    if (
      !parsed.success ||
      positionals.length > 2 ||
      (positionals[1] &&
        values.client !== "cli" &&
        values.client !== positionals[1])
    )
      throw new GroveError(
        "invalid_client",
        "Use grove connect opencode, claude or codex",
      );
    if (values["key-stdin"] || values.stdio)
      throw new GroveError(
        "invalid_command",
        "Use grove login --key-stdin for API keys, or grove mcp --stdio for the bridge",
      );
    await connectAgent(
      {
        agent: parsed.data,
        origin: values.url ?? (process.env.GROVE_API_URL || cloudOrigin),
        noBrowser: !!values["no-browser"],
        json: !!values.json,
      },
      login,
    );
    return;
  }
  const agent = values.client as AgentName;
  if (!["cli", "opencode", "claude", "codex"].includes(agent))
    throw new GroveError(
      "invalid_client",
      "Choose cli, opencode, claude or codex",
    );
  if (command === "mcp") {
    if (!values.stdio)
      throw new GroveError("invalid_command", "Use grove mcp --stdio");
    await startBridge(agent);
    return;
  }
  if (command === "serve") {
    const serverPackage = "@miniaxolotl/grove-server";
    try {
      const { startServer } = await import(serverPackage);
      await startServer();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND")
        throw error;
      throw new GroveError(
        "server_missing",
        "Install @miniaxolotl/grove-server or use the PostgreSQL Compose deployment",
      );
    }
    return;
  }
  if (command === "pause" || command === "resume") {
    await updateConfig({ paused: command === "pause" });
    console.log(
      command === "pause"
        ? "Automatic memory paused"
        : "Automatic memory resumed",
    );
    return;
  }
  if (command === "uninstall") {
    await installIntegration(agent, true);
    return;
  }
  const origin = await configuredOrigin(
    values.url,
    agent,
    command === "login" || command === "init" ? cloudOrigin : undefined,
  );
  if (command === "login" || command === "init") {
    const me = await login(
      origin,
      agent,
      !!values["key-stdin"],
      !!values["no-browser"],
    );
    console.log(
      JSON.stringify({
        status: me.capabilities.length ? "connected" : "awaiting-grant",
        accountId: me.accountId,
        connectionId: me.connectionId,
        origin,
      }),
    );
    if (!me.capabilities.length)
      console.log(
        "Approve this client and choose its project/personal access in the Grove Connections page.",
      );
    if (command === "init") {
      if (agent === "cli")
        throw new GroveError(
          "choose_client",
          "Choose --client opencode, claude or codex to install",
        );
      await installIntegration(agent);
      console.error(activationInstructions(agent).message);
      if (me.capabilities.includes("memory:read"))
        console.log(
          JSON.stringify({
            projectId: await resolveProject(
              await nodeClient(agent),
              process.cwd(),
              me.capabilities.includes("memory:write") &&
                !!me.grant?.allProjects,
            ),
          }),
        );
    }
    return;
  }
  const client = await nodeClient(agent, origin);
  if (command === "status") {
    const me = await client.request<ConnectionInfo>("/v1/me");
    const status = {
      status: me.capabilities.length ? "connected" : "awaiting-grant",
      origin,
      agent,
      ...me,
      projectId: me.capabilities.includes("memory:read")
        ? await resolveProject(client, process.cwd())
        : null,
    };
    console.log(
      values.json
        ? JSON.stringify(status)
        : `${status.status}\nAccount: ${me.accountId}\nAPI: ${origin}\nClient: ${agent}\nCapabilities: ${me.capabilities.join(", ") || "none (approve in Connections)"}`,
    );
    if (!me.capabilities.length) process.exitCode = 1;
    return;
  }
  if (command === "project") {
    console.log(
      JSON.stringify({
        projectId: await resolveProject(client, process.cwd(), true),
      }),
    );
    return;
  }
  if (command === "logout") {
    try {
      await client.request("/v1/logout", { body: {} });
    } catch (error) {
      console.error(
        `Remote revocation not confirmed (${error instanceof GroveError ? error.code : "unavailable"}); revoke the connection from the dashboard.`,
      );
      process.exitCode = 1;
    }
    await clearCredentials(origin, agent);
    console.log("Local credentials cleared");
    return;
  }
  throw new GroveError("invalid_command", help);
}
main()
  .catch((error) => {
    commandFailure = error;
    const output = {
      status: "error",
      code: error instanceof GroveError ? error.code : "unavailable",
      message:
        error instanceof GroveError
          ? error.message
          : "Grove could not complete the command",
    };
    (process.argv.includes("--json") ? console.log : console.error)(
      JSON.stringify(output),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!observedCommand) return;
    const outcome = commandFailure
      ? operationOutcome(commandFailure)
      : "success";
    telemetry("cli").operation(
      "command_run",
      commandStarted,
      outcome,
      {
        command: observedCommand,
      },
      commandFailure,
    );
    telemetry("cli").capture("command_completed", {
      command: observedCommand,
      outcome,
    });
    if (!["mcp", "serve"].includes(observedCommand)) await closeTelemetry();
  });
