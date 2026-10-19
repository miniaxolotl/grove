import { Plugin, Skill } from "@opencode/plugin";
import { Error as ToolError } from "@opencode/plugin/promise/tool";
import { fileURLToPath } from "node:url";
import { automaticContext, readConfig } from "@lib/integration-core/node";
import { memorySkill } from "@lib/integration-core";

export default Plugin.define({
  id: "grove",
  async setup(ctx) {
    const bridge = fileURLToPath(new URL("./cli.js", import.meta.url));
    await ctx.mcp.transform((editor) => {
      if (!editor.get("grove"))
        editor.set("grove", {
          type: "local",
          command: ["node", bridge, "mcp", "--stdio", "--client", "opencode"],
        });
    });
    await ctx.skill.transform((editor) =>
      editor.add({
        id: Skill.ID.make("grove-memory"),
        name: Skill.Name.make("Grove memory"),
        description:
          "Save or recall concise private memories and task handoffs across sessions.",
        path: Skill.Info.fields.path.make(
          fileURLToPath(new URL("./memory-skill.md", import.meta.url)),
        ),
        content: memorySkill,
      }),
    );
    await ctx.tool.hook("execute.before", async (event) => {
      if (
        event.tool !== "grove_remember" ||
        (event.input as { capture?: string } | null)?.capture !== "automatic"
      )
        return;
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (
        ctx.options.private === true ||
        session.metadata?.private === true ||
        process.env.GROVE_PRIVATE === "1" ||
        (await readConfig()).paused
      ) {
        throw new ToolError({
          message:
            "Automatic memory is paused for this session. Only explicit user-requested saves are available.",
        });
      }
    });
    await ctx.session.hook("context", async (event) => {
      if (ctx.options.private === true || process.env.GROVE_PRIVATE === "1")
        return;
      try {
        const session = await ctx.session.get({ sessionID: event.sessionID });
        if (session.metadata?.private === true) return;
        const context = await automaticContext(
          "opencode",
          session.location.directory,
        );
        if (context) event.system.push({ type: "text", text: context });
      } catch {
        /* Optional recall never interrupts the user's task. */
      }
    });
  },
});
