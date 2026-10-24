import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryMcp } from "@lib/integration-core/mcp";
import {
  nodeClient,
  readConfig,
  type AgentName,
} from "@lib/integration-core/node";
import { GroveError } from "@lib/shared/contracts";
import { telemetry, closeTelemetry, type Outcome } from "@lib/telemetry";
import { outcome } from "@lib/telemetry/context";

export async function startBridge(agent: AgentName = "cli") {
  const server = createMemoryMcp(async (tool, raw, signal) => {
    const started = performance.now();
    let result: Outcome = "success";
    let failure: unknown;
    try {
      // A running host picks up completed login and explicit endpoint/account switches.
      const client = await nodeClient(agent);
      const input = { ...(raw as Record<string, unknown>) };
      if (tool === "remember")
        input.source = { ...(input.source as Record<string, unknown>), agent };
      if (
        (tool === "remember" || tool === "update_memory") &&
        input.capture === "automatic" &&
        (process.env.GROVE_PRIVATE === "1" || (await readConfig()).paused)
      )
        throw new GroveError(
          "capture_paused",
          "Automatic memory is paused locally",
          403,
        );
      // Scope stays explicit. Hosts learn their project ID from setup/context; no cross-project default.
      const path =
        tool === "remember"
          ? "/v1/memories"
          : tool === "recall"
            ? "/v1/recall"
            : tool === "memories"
              ? "/v1/memories/search"
              : tool === "forget"
                ? "/v1/memories/delete"
                : `/v1/tools/${tool}`;
      return await client.request(path, { body: input, signal });
    } catch (error) {
      result = outcome(error);
      failure = error;
      throw error;
    } finally {
      telemetry("mcp").operation(
        "mcp_tool",
        started,
        result,
        { agent },
        failure,
      );
    }
  });
  const onclose = server.server.onclose;
  server.server.onclose = () => {
    onclose?.();
    void closeTelemetry();
  };
  await server.connect(new StdioServerTransport());
  const close = () => void server.close();
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  return server;
}
