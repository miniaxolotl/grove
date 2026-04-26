import type { GrovePluginOptions } from "../index.js";
import { MCPClient } from "../client/index.js";

const HOT_THRESHOLD = 0.8;

export function createContextEngine(
  _directory: string,
  opts: GrovePluginOptions,
) {
  const mcp = new MCPClient({ url: opts.mcpUrl ?? "http://localhost:3100/mcp" });

  async function queryHotMemories(): Promise<MemorySearchResult[]> {
    try {
      const memories = await mcp.searchMemories({
        query: "important decision error resolution",
        limit: 10,
      });

      return memories.filter((m) => m.score >= HOT_THRESHOLD);
    } catch (err) {
      console.error("[grove] Failed to query hot memories:", err);
      return [];
    }
  }

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
