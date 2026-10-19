import { automaticContext, type AgentName } from "@lib/integration-core/node";
import { memorySkill } from "@lib/integration-core";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 65536) process.exit(0);
}
try {
  const event = JSON.parse(input);
  const agent = (process.argv[2] === "codex" ? "codex" : "claude") as AgentName;
  if (
    event.hook_event_name !== "SessionStart" ||
    process.env.GROVE_PRIVATE === "1"
  )
    process.exit(0);
  const context = await automaticContext(
    agent,
    event.cwd ?? process.cwd(),
    undefined,
    6000 - memorySkill.length - 2,
  );
  // The hook never ingests a transcript or recursively starts another agent turn.
  if (context)
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: `${memorySkill}\n\n${context}`,
        },
      }),
    );
} catch {
  /* Optional context must not stop normal agent work. */
}
