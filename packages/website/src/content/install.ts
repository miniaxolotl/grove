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
export const firstMemory =
  'Use Grove to remember this confirmed decision in my current project: "We use PostgreSQL for billing because we need transactions."';
export const recallMemory =
  "Recall our billing database decision from Grove for this project. What did we decide, and why?";
