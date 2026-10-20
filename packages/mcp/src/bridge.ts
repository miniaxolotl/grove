import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryMcp } from "@lib/integration-core/mcp";
import {
  nodeClient,
  readConfig,
  type AgentName,
} from "@lib/integration-core/node";
import { GroveError } from "@lib/shared/contracts";

export async function startBridge(agent: AgentName = "cli") {
  const server = createMemoryMcp(async (tool, raw, signal) => {
    // A running host picks up completed login and explicit endpoint/account switches.
    const client = await nodeClient(agent);
    const input = { ...(raw as Record<string, unknown>) };
    if (tool === "remember")
      input.source = { ...(input.source as Record<string, unknown>), agent };
    if (
      tool === "remember" &&
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
            : "/v1/memories/delete";
    return client.request(path, { body: input, signal });
  });
  await server.connect(new StdioServerTransport());
  const close = () => void server.close();
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  return server;
}
