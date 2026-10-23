import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  findExecutable,
  type DiagnosticCheck,
  type DiagnosticReport,
} from "@lib/integration-core/diagnostics";
import {
  bearer,
  configuredOrigin,
  loadCredentials,
  readConfig,
} from "@lib/integration-core/node";
import { GroveError } from "@lib/shared/contracts";
import {
  ApiClient,
  apiOrigin,
  type ConnectionInfo,
} from "@lib/integration-core";

const codes = new Set([
  "not_configured",
  "invalid_config",
  "invalid_endpoint",
  "sign_in_required",
  "unauthorized",
  "connection_revoked",
  "timeout",
  "unreachable",
  "invalid_response",
  "credential_store_unavailable",
  "awaiting_grant",
  "api_version_unsupported",
]);
const safeCode = (error: unknown) =>
  error instanceof GroveError && codes.has(error.code)
    ? error.code
    : "unavailable";

export async function diagnose(
  client: DiagnosticReport["client"],
  probe = false,
  originOverride?: string,
): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const add = (
    id: string,
    status: DiagnosticCheck["status"],
    code: string,
    message: string,
    context: DiagnosticCheck["context"] = "cli",
  ) => checks.push({ id, status, code, message, context });
  const clientExecutable = await findExecutable(client);
  add(
    "client",
    clientExecutable ? "passed" : "failed",
    clientExecutable ? "client_found" : "client_missing",
    clientExecutable
      ? `Client executable found on this CLI's PATH; ${client} was not started.`
      : `Install ${client} and make its executable available on PATH. This CLI cannot inspect the agent host's environment.`,
  );
  const runtimeReady = Number(process.versions.node.split(".")[0]) >= 22;
  add(
    "runtime",
    runtimeReady ? "passed" : "failed",
    runtimeReady ? "runtime_available" : "runtime_unsupported",
    "The Grove CLI requires Node 22+ or a compatible Bun runtime. This does not verify the agent host's PATH.",
  );
  const executable = fileURLToPath(new URL("./cli.js", import.meta.url));
  let artifactReady = false;
  try {
    artifactReady = (await stat(executable)).isFile();
  } catch {
    /* Report below. */
  }
  add(
    "artifact",
    artifactReady ? "passed" : "failed",
    artifactReady ? "artifact_found" : "artifact_missing",
    artifactReady
      ? "Packaged Grove CLI entrypoint exists."
      : "Reinstall the Grove package; its prebuilt entrypoint is missing.",
  );
  let origin: string | undefined;
  try {
    await readConfig();
    origin = await configuredOrigin(originOverride, client);
    add(
      "configuration",
      "passed",
      "configuration_readable",
      "Local endpoint selection is readable; unrelated agent configuration is not changed.",
    );
    if (
      !(
        process.env.GROVE_API_KEY &&
        process.env.GROVE_API_URL &&
        apiOrigin(process.env.GROVE_API_URL) === origin
      )
    )
      await loadCredentials(origin, client);
    add(
      "credentials",
      "passed",
      "credentials_present",
      "Credentials exist locally; validity requires an explicit API probe.",
    );
  } catch (error) {
    add(
      "credentials",
      "failed",
      safeCode(error),
      "Check the selected Grove endpoint and credential store. Run grove login only if sign-in is actually required; no credentials were removed.",
    );
  }
  if (probe && runtimeReady && artifactReady) {
    const connection = new Client({ name: "grove-doctor", version: "1" });
    const env: Record<string, string> = { GROVE_TELEMETRY: "0" };
    for (const name of [
      "HOME",
      "USERPROFILE",
      "PATH",
      "SystemRoot",
      "TMP",
      "TEMP",
      "TMPDIR",
      "XDG_CONFIG_HOME",
      "GROVE_CONFIG_HOME",
      "GROVE_API_URL",
      "GROVE_API_KEY",
      "GROVE_PRIVATE",
    ])
      if (process.env[name] !== undefined) env[name] = process.env[name]!;
    if (process.versions.bun) env.BUN_BE_BUN = "1";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [executable, "mcp", "--stdio", "--client", client],
      env,
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => {
      /* Discard bounded startup diagnostics; never echo secrets. */
    });
    try {
      const signal = AbortSignal.timeout(5000);
      await connection.connect(transport, { signal, timeout: 5000 });
      const tools = (await connection.listTools({}, { signal, timeout: 5000 }))
        .tools;
      if (
        tools
          .map((tool) => tool.name)
          .sort()
          .join(",") !== "forget,memories,recall,remember"
      )
        throw new Error("Unexpected tool catalog");
      add(
        "bridge",
        "passed",
        "bridge_initialized",
        "A separate packaged bridge initialized and listed four tools; no memory tool was invoked.",
        "bridge_probe",
      );
    } catch {
      add(
        "bridge",
        "failed",
        "bridge_start_failed",
        "The packaged bridge did not initialize within its startup budget. Check runtime and package integrity.",
        "bridge_probe",
      );
    } finally {
      await connection.close();
      await transport.close();
    }
  } else {
    add(
      "bridge",
      "skipped",
      "probe_not_run",
      "Use --probe to start only Grove's packaged bridge; this is not a live-host check.",
      "bridge_probe",
    );
  }
  if (probe && origin) {
    try {
      const endpoint = origin;
      const api = new ApiClient(
        endpoint,
        (signal) => bearer(endpoint, client, signal),
        5000,
        {
          disabled: () => true,
          completed: () => {
            /* Diagnostics opt out upstream without initializing a reporter. */
          },
        },
      );
      const me = await api.request<Partial<ConnectionInfo> | null>("/v1/me");
      if (
        !me ||
        typeof me.accountId !== "string" ||
        !Array.isArray(me.capabilities) ||
        !me.capabilities.every(
          (capability) => typeof capability === "string",
        ) ||
        typeof me.apiVersion !== "number"
      )
        throw new GroveError(
          "invalid_response",
          "Invalid Grove API identity response",
          502,
        );
      if (me.apiVersion !== 1)
        throw new GroveError(
          "api_version_unsupported",
          "This Grove API version is not supported by the installed CLI",
          409,
        );
      if (!me.capabilities.length)
        throw new GroveError(
          "awaiting_grant",
          "Approve this agent's access in Grove Connections",
          403,
        );
      add(
        "api",
        "passed",
        "api_access_verified",
        "Authenticated API access works from this CLI; host activation is not verified.",
      );
    } catch (error) {
      add(
        "api",
        "failed",
        safeCode(error),
        "API verification failed. Check sign-in, grant and endpoint availability; configuration is preserved.",
      );
    }
  } else {
    add(
      "api",
      "skipped",
      "probe_not_run",
      "No API request made. Use --probe for an authenticated read-only check.",
    );
  }
  add(
    "host",
    "unknown",
    "host_not_verified",
    client === "opencode"
      ? "Check Grove in OpenCode's /mcps. OpenCode reuses its runtime; a local probe does not verify the running session."
      : `Check Grove in ${client}'s plugin/MCP interface. Its host needs Node 22+ on PATH; optional hooks require host trust.`,
    "host",
  );
  return {
    schemaVersion: 1,
    client,
    observedAt: new Date().toISOString(),
    status: checks.some((check) => check.status === "failed")
      ? "attention"
      : "ok",
    hostVerified: false,
    checks,
  };
}
