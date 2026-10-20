import { createInterface } from "node:readline/promises";
import {
  GroveError,
  agentNames,
  type ConnectInput,
} from "@lib/shared/contracts";
import { requireClient } from "./install.ts";

export async function selectAgent(
  interactive: boolean,
): Promise<ConnectInput["agent"]> {
  const agents = ["opencode", "claude", "codex"] as const;
  const available = (
    await Promise.all(
      agents.map(async (agent) => {
        try {
          await requireClient(agent);
          return agent;
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((agent) => agent !== undefined);
  if (!available.length)
    throw new GroveError(
      "client_missing",
      "Install OpenCode, Claude Code or Codex, then run grove connect. Setup guide: https://usegrove.cloud/install",
    );
  if (available.length === 1) return available[0];
  if (!interactive)
    throw new GroveError(
      "choose_client",
      `Choose an agent: ${available.map((agent) => `grove connect ${agent}`).join(" or ")}`,
    );
  console.error("Welcome to Grove. Which agent would you like to connect?");
  available.forEach((agent, index) =>
    console.error(`  ${index + 1}. ${agentNames[agent]}`),
  );
  const input = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    for (;;) {
      const answer = (await input.question("Choose a number or name [1]: "))
        .trim()
        .toLowerCase();
      const selected =
        available[Number(answer || "1") - 1] ??
        available.find(
          (agent) =>
            agent === answer || agentNames[agent].toLowerCase() === answer,
        );
      if (selected) return selected;
      console.error("Choose one of the installed agents above.");
    }
  } finally {
    input.close();
  }
}
