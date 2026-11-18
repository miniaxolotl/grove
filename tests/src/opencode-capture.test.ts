import assert from "node:assert/strict";
import { test } from "node:test";
import grove from "../../packages/grove-opencode-plugin/src/index.ts";

test("private OpenCode sessions gate automatic captures including targeted edits", async () => {
  type Event = { tool: string; sessionID: string; input: { capture: string } };
  let before!: (event: Event) => Promise<void>;
  const options = { private: false };
  await grove.setup({
    options,
    mcp: { transform() {} },
    skill: { transform() {} },
    session: {
      hook() {},
      get: async ({ sessionID }: Event) => ({
        metadata: { private: sessionID === "private" },
      }),
    },
    tool: {
      hook: (_name: string, handler: typeof before) => {
        before = handler;
      },
    },
  } as unknown as Parameters<typeof grove.setup>[0]);
  for (const tool of [
    "grove_preview_memory_patch",
    "grove_apply_memory_patch",
    "grove_update_memory",
    "grove_remember",
  ]) {
    for (const sessionID of ["private", "public"]) {
      options.private = sessionID === "public";
      await assert.rejects(
        before({ tool, sessionID, input: { capture: "automatic" } }),
        /Automatic memory is paused/,
      );
      await before({ tool, sessionID, input: { capture: "explicit" } });
    }
  }
  await before({
    tool: "other_remember",
    sessionID: "private",
    input: { capture: "automatic" },
  });
});
