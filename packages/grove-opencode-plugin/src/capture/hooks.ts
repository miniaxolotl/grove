import type { PluginInput } from "@opencode-ai/plugin";
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

function gitLog(cwd: string): string {
  try {
    const { execSync } = require("child_process");
    const log = execSync("git log --oneline -1", { cwd, encoding: "utf-8" });
    return log.trim();
  } catch {
    return "";
  }
}

export function createCaptureHooks(
  pluginInput: PluginInput,
  opts: GrovePluginOptions,
) {
  const mcp = new MCPClient({ url: opts.mcpUrl ?? "http://localhost:3100/mcp" });

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
      console.error("[grove-plugin] Failed to save memory:", err);
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

  async function onChatMessage(
    input: { sessionID: string },
    output: { message: { role: string }; parts: unknown[] },
  ): Promise<void> {
    const msg = output.message as { role: string; content?: string };

    if (msg.role === "user" && msg.content) {
      if (msg.content.match(/https?:\/\//)) {
        await captureMemory({
          type: "reference",
          text: `User referenced: ${msg.content}`,
          sessionId: input.sessionID,
          project: opts.project,
        });
      }
    }

    if (msg.role === "assistant") {
      const gitInfo = gitLog(pluginInput.directory);
      if (gitInfo) {
        await captureMemory({
          type: "activity_log",
          text: `Git: ${gitInfo}`,
          sessionId: input.sessionID,
          project: opts.project,
        });
      }
    }
  }

  return {
    capture: captureMemory,
    onToolExecuted,
    onChatMessage,
  };
}
