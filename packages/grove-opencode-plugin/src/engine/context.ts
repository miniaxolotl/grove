import type { PluginInput } from "@opencode-ai/plugin";
import type { GrovePluginOptions } from "../index.js";
import type { MemorySearchResult } from "../client/index.js";
import { MCPClient } from "../client/index.js";

const HOT_THRESHOLD = 0.8;

export function createContextEngine(
  _pluginInput: PluginInput,
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
      console.error("[grove-plugin] Failed to query hot memories:", err);
      return [];
    }
  }

  async function injectContext(
    input: { sessionID?: string },
    output: { system: string[] },
  ): Promise<void> {
    const hotMemories = await queryHotMemories();

    if (hotMemories.length === 0) {
      return;
    }

    const memoryContext = hotMemories
      .map((m) => `[Memory ${(m.score * 100).toFixed(0)}%] ${m.text}`)
      .join("\n");

    output.system.push(
      `\n--- Grove Hot Memories ---\n${memoryContext}\n--- End Grove ---\n`,
    );
  }

  async function onSessionCompacting(
    input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> {
    console.log(
      `[grove-plugin] Session ${input.sessionID} compacting, current context items: ${output.context.length}`,
    );

    try {
      const compacted = await mcp.compactMemories({
        sessionId: input.sessionID,
        importanceThreshold: opts.importanceThreshold ?? 0.6,
      });
      console.log(`[grove-plugin] Compacted ${compacted} memories for session ${input.sessionID}`);
    } catch (err) {
      console.error("[grove-plugin] Failed to compact memories:", err);
    }

    output.context.push(
      `Session ${input.sessionID} compacted. Consider using grove memory_compact tool if needed.`,
    );
  }

  return {
    injectContext,
    onSessionCompacting,
  };
}
