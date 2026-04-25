import type { PluginInput } from "@opencode-ai/plugin";
import type { GrovePluginOptions } from "../index.js";

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

function gitLog(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const { execSync } = require("child_process");
    try {
      const log = execSync("git log --oneline -1", { cwd, encoding: "utf-8" });
      resolve(log.trim());
    } catch {
      resolve("");
    }
  });
}

export function createCaptureHooks(
  _input: PluginInput,
  _opts: GrovePluginOptions,
) {
  async function captureMemory(input: CaptureInput): Promise<void> {
    const importance = input.importance ?? computeImportance(input.type);

    const memory = {
      text: input.text,
      metadata: {
        source: "opencode",
        project: input.project,
        tags: input.tags ?? [],
        sessionId: input.sessionId,
        importance,
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
        createdAt: new Date().toISOString(),
      },
    };

    console.log("[grove-plugin] Capturing memory:", JSON.stringify(memory, null, 2));
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
        project: _opts.project,
      });
    }
  }

  async function onChatMessage(
    input: { sessionID: string; messageID?: string },
    output: { message: { role: string; content: string }; parts: unknown[] },
  ): Promise<void> {
    if (output.message.role === "user") {
      const content = output.message.content;

      if (content.match(/https?:\/\//)) {
        await captureMemory({
          type: "reference",
          text: `User referenced: ${content}`,
          sessionId: input.sessionID,
          project: _opts.project,
        });
      }
    }

    if (output.message.role === "assistant") {
      const gitInfo = await gitLog(_input.directory);
      if (gitInfo) {
        await captureMemory({
          type: "activity_log",
          text: `Git: ${gitInfo}`,
          sessionId: input.sessionID,
          project: _opts.project,
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
