import type { GrovePluginOptions } from "../index.js";
import { MCPClient } from "../client/index.js";

export type CaptureType = "decision" | "error_resolution" | "activity_log" | "reference";

export interface CaptureInput {
  type: CaptureType;
  text: string;
  tags?: string[];
  sessionId: string;
  project?: string;
  importance?: number;
}

const BASE_IMPORTANCE: Record<CaptureType, number> = {
  decision: 0.8,
  error_resolution: 0.75,
  activity_log: 0.5,
  reference: 0.4,
};

function computeImportance(type: CaptureType): number {
  return BASE_IMPORTANCE[type];
}

export function createCaptureHooks(opts: GrovePluginOptions) {
  const mcp = new MCPClient({ url: opts.mcpUrl ?? "http://localhost:26080/mcp" });

  async function captureMemory(input: CaptureInput): Promise<void> {
    const importance = input.importance ?? computeImportance(input.type);

    try {
      await mcp.saveMemory(input.text, {
        source: "opencode",
        project: input.project,
        tags: input.tags ?? [],
        sessionId: input.sessionId,
        importance,
      });
    } catch (err) {
      console.error("[grove] Failed to save memory:", err);
    }
  }

  async function onToolExecuted(
    input: { tool: string; sessionID: string; args: unknown },
    output: { title: string; output: string },
  ): Promise<void> {
    if (input.tool === "memory_save" || input.tool === "memory_note") {
      return;
    }

    if (output.title.toLowerCase().includes("error")) {
      await captureMemory({
        type: "error_resolution",
        text: `Tool ${input.tool} error: ${output.output}. User may have resolved it.`,
        sessionId: input.sessionID,
        project: opts.project,
      });
    }
  }

  return {
    capture: captureMemory,
    onToolExecuted,
  };
}
