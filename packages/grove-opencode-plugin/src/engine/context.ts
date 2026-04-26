import type { GrovePluginOptions } from "../index.js";
import { MCPClient } from "../client/index.js";

export function createContextEngine(opts: GrovePluginOptions) {
  const mcp = new MCPClient({ url: opts.mcpUrl ?? "http://localhost:26080/mcp" });

  async function onSessionCompacting(
    input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> {
    console.log(
      `[grove] Session ${input.sessionID} compacting, context items: ${output.context?.length ?? "unknown"}`,
    );

    try {
      const compacted = await mcp.compactMemories({
        sessionId: input.sessionID,
        importanceThreshold: opts.importanceThreshold ?? 0.6,
      });
      console.log(`[grove] Compacted ${compacted} memories for session ${input.sessionID}`);
    } catch (err) {
      console.error("[grove] Failed to compact memories:", err);
    }
  }

  return {
    onSessionCompacting,
  };
}
