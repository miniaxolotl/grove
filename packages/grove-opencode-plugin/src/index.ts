import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { createCaptureHooks } from "./capture/hooks.js";
import { createContextEngine } from "./engine/context.js";

export interface GrovePluginOptions {
  mcpUrl?: string;
  project?: string;
  importanceThreshold?: number;
  stalenessDays?: number;
  maxContextItems?: number;
}

export const grovePlugin: Plugin = async (
  input: PluginInput,
  options?: GrovePluginOptions,
) => {
  const opts = {
    mcpUrl: options?.mcpUrl ?? "http://localhost:3100/mcp",
    project: options?.project,
    importanceThreshold: options?.importanceThreshold ?? 0.6,
    stalenessDays: options?.stalenessDays ?? 7,
    maxContextItems: options?.maxContextItems ?? 20,
  };

  const capture = createCaptureHooks(input, opts);
  const contextEngine = createContextEngine(input, opts);

  return {
    tool: {
      grove_save_memory: tool({
        description: "Save a memory to Grove semantic storage",
        args: {
          information: z.string().describe("The memory content to save"),
          tags: z.array(z.string()).optional().describe("Tags for the memory"),
        },
        execute: async (args, ctx) => {
          await capture.capture({
            type: "activity_log",
            text: args.information,
            tags: args.tags,
            sessionId: ctx.sessionID,
            project: opts.project,
          });
          return `Saved memory for session ${ctx.sessionID}`;
        },
      }),
    },
    async "tool.execute.after"(input, output) {
      await capture.onToolExecuted(input, output);
    },
    async "experimental.chat.system.transform"(input, output) {
      await contextEngine.injectContext(input, output);
    },
    async "experimental.session.compacting"(input, output) {
      await contextEngine.onSessionCompacting(input, output);
    },
  };
};

export default grovePlugin;
