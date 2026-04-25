import type { GrovePluginOptions } from "../index.js";
import { MCPClient } from "../client/index.js";

const DECAY_RATE = 0.01;

export function createImportanceEngine(opts: GrovePluginOptions) {
  const mcp = new MCPClient({ url: opts.mcpUrl ?? "http://localhost:3100/mcp" });

  function applyDecay(currentImportance: number, daysSinceAccess: number): number {
    const decayed = currentImportance - daysSinceAccess * DECAY_RATE;
    return Math.max(0.1, decayed);
  }

  async function decayMemories(sessionId?: string): Promise<{ decayed: number }> {
    let decayed = 0;

    try {
      const memories = await mcp.searchMemories({
        query: "",
        limit: 100,
        project: opts.project,
      });

      const now = new Date();

      for (const memory of memories) {
        if (memory.metadata?.importance === undefined || memory.metadata?.importance <= 0.1) {
          continue;
        }

        const lastAccessed = memory.metadata.lastAccessedAt
          ? new Date(memory.metadata.lastAccessedAt)
          : new Date(memory.metadata.createdAt || now);

        const daysSinceAccess = Math.floor((now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceAccess > 0) {
          const newImportance = applyDecay(memory.metadata.importance, daysSinceAccess);

          try {
            await mcp.callTool("memory_update" as never, {
              id: memory.id,
              metadata: { importance: newImportance },
            } as never);
            decayed++;
          } catch {
            // Memory may have been deleted already
          }
        }
      }
    } catch (err) {
      console.error("[grove-plugin] Failed to decay importance:", err);
    }

    return { decayed };
  }

  return {
    applyDecay,
    decayMemories,
  };
}
