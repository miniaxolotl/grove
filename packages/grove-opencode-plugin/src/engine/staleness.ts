import type { GrovePluginOptions } from "../index.js";
import { MCPClient } from "../client/index.js";

interface StaleMemory {
  id: string;
  text: string;
  metadata: {
    lastAccessedAt?: string;
    importance?: number;
    sessionId?: string;
  };
}

export function createStalenessEngine(opts: GrovePluginOptions) {
  const mcp = new MCPClient({ url: opts.mcpUrl ?? "http://localhost:26080/mcp" });

  async function findStaleMemories(daysThreshold: number): Promise<StaleMemory[]> {
    const staleMemories: StaleMemory[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

    try {
      const memories = await mcp.searchMemories({
        query: "",
        limit: 100,
      });

      for (const memory of memories) {
        const lastAccessedAt = memory.metadata?.lastAccessedAt;
        if (lastAccessedAt) {
          const lastAccessed = new Date(lastAccessedAt);
          if (lastAccessed < cutoffDate) {
            staleMemories.push(memory as StaleMemory);
          }
        }
      }
    } catch (err) {
      console.error("[grove-plugin] Failed to find stale memories:", err);
    }

    return staleMemories;
  }

  async function onStalenessCheck(): Promise<{ staleCount: number; message: string }> {
    const staleMemories = await findStaleMemories(opts.stalenessDays ?? 7);

    if (staleMemories.length === 0) {
      return { staleCount: 0, message: "No stale memories found" };
    }

    const message = `Found ${staleMemories.length} stale memories not accessed in ${opts.stalenessDays ?? 7}+ days. Consider running memory_prune to remove them.`;

    return { staleCount: staleMemories.length, message };
  }

  return {
    findStaleMemories,
    onStalenessCheck,
  };
}
