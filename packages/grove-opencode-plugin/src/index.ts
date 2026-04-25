import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { createCaptureHooks } from "./capture/hooks.js";
import { createContextEngine } from "./engine/context.js";
import { createStalenessEngine } from "./engine/staleness.js";
import { createImportanceEngine } from "./engine/importance.js";
import { MCPClient } from "./client/index.js";

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
  const stalenessEngine = createStalenessEngine(opts);
  const importanceEngine = createImportanceEngine(opts);
  const mcp = new MCPClient({ url: opts.mcpUrl });

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
      grove_check_staleness: tool({
        description: "Check for stale memories that haven't been accessed in a while",
        args: {},
        execute: async () => {
          const result = await stalenessEngine.onStalenessCheck();
          return result.message;
        },
      }),
      grove_compact_session: tool({
        description: "Compact memories for a specific session",
        args: {
          sessionId: z.string().describe("Session ID to compact"),
        },
        execute: async (args) => {
          const compacted = await mcp.compactMemories({
            sessionId: args.sessionId,
            importanceThreshold: opts.importanceThreshold,
          });
          return `Compacted ${compacted} memories`;
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
      await importanceEngine.decayMemories(input.sessionID);

      const staleResult = await stalenessEngine.onStalenessCheck();
      if (staleResult.staleCount > 0) {
        output.context.push(`[grove-plugin] ${staleResult.message}`);
      }
    },
  };
};

export default grovePlugin;
