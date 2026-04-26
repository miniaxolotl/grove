import type { Plugin } from "@opencode-ai/plugin";
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
}

export const grovePlugin: Plugin = async (ctx) => {
  const directory = ctx.directory || ".";

  const mcpUrl = process.env.GROVE_MCP_URL || "http://localhost:26080/mcp";
  const project = process.env.GROVE_PROJECT;

  const opts: GrovePluginOptions = {
    mcpUrl,
    project,
    importanceThreshold: 0.6,
    stalenessDays: 7,
  };

  const capture = createCaptureHooks(opts);
  const contextEngine = createContextEngine(opts);
  const stalenessEngine = createStalenessEngine(opts);
  const importanceEngine = createImportanceEngine(opts);
  const mcp = new MCPClient({ url: mcpUrl });

  return {
    tool: {
      grove_save_memory: tool({
        description: "Save a memory to Grove semantic storage",
        args: {
          information: z.string().describe("The memory content to save"),
          tags: z.array(z.string()).optional().describe("Tags for the memory"),
        },
        execute: async (args, context) => {
          await capture.capture({
            type: "activity_log",
            text: args.information,
            tags: args.tags,
            sessionId: context.sessionID,
            project: opts.project,
          });
          return `Saved memory for session ${context.sessionID}`;
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
    async "tool.execute.after"(input: { tool: string; sessionID: string; args: unknown }, output: { title: string; output: string }) {
      try {
        await capture.onToolExecuted(input, output);
      } catch (err) {
        console.error("[grove] tool.execute.after hook failed:", err);
      }
    },
    async "experimental.session.compacting"(input: { sessionID: string }, output: { context: string[]; prompt?: string }) {
      try {
        await contextEngine.onSessionCompacting(input, output);
        await importanceEngine.decayMemories(input.sessionID);

        const staleResult = await stalenessEngine.onStalenessCheck();
        if (staleResult.staleCount > 0) {
          output.context.push(`[grove] ${staleResult.message}`);
        }
      } catch (err) {
        console.error("[grove] session.compacting hook failed:", err);
      }
    },
  };
};

export default grovePlugin;
