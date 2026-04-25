import type { PluginInput } from "@opencode-ai/plugin";
import type { GrovePluginOptions } from "../index.js";

interface MemoryItem {
  id: string;
  text: string;
  score: number;
  metadata: {
    importance?: number;
    project?: string;
    tags?: string[];
    sessionId?: string;
  };
}

const HOT_THRESHOLD = 0.8;
const WARM_THRESHOLD = 0.5;

export function createContextEngine(
  _input: PluginInput,
  _opts: GrovePluginOptions,
) {
  async function queryHotMemories(): Promise<MemoryItem[]> {
    console.log("[grove-plugin] Querying hot memories (importance > 0.8)");
    return [];
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
      .map(
        (m) =>
          `[Memory ${m.score.toFixed(2)}] ${m.text}`,
      )
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

    output.context.push(
      `Session ${input.sessionID} should be compacted using grove memory_compact tool after summarization.`,
    );
  }

  return {
    injectContext,
    onSessionCompacting,
  };
}
