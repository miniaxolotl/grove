export const dockerSetup = `git clone https://github.com/miniaxolotl/grove.git
cd grove
cp .env.example .env
# Set Grove Clerk keys and generated passwords in .env
docker compose up -d --build`;

export const connectCommand = (
  agent: "opencode" | "claude" | "codex",
  origin?: string,
) =>
  `npx @miniaxolotl/grove connect ${agent}${origin && origin !== "https://api.usegrove.cloud" ? ` --url ${origin}` : ""}`;

export const mcpEndpoint = "https://api.usegrove.cloud/mcp";
export const clientOptions = [
  { value: "opencode", label: "OpenCode" },
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude-web", label: "Claude web" },
  { value: "mcp", label: "Other MCP clients" },
];
export const hostedClients = {
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/plugins" },
  "claude-web": {
    name: "Claude web",
    url: "https://claude.ai/customize/connectors",
  },
} as const;
export const isHostedClient = (
  value: string,
): value is keyof typeof hostedClients =>
  value === "chatgpt" || value === "claude-web";
export const firstPersonalMemory =
  'Use Grove to remember this preference in my personal notes: "I prefer concise answers with one worked example."';
export const recallPersonalMemory =
  "Use Grove to recall my personal preference about answers and examples.";
export const firstMemory =
  'Use Grove to remember this confirmed decision in my current project: "We use PostgreSQL for billing because we need transactions."';
export const recallMemory =
  "Recall our billing database decision from Grove for this project. What did we decide, and why?";
