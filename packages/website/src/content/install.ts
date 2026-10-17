export const dockerSetup = `git clone https://github.com/miniaxolotl/grove.git
cd grove
cp .env.example .env
docker compose up -d`;

export const npmSetup = `# Start a persistent local Qdrant instance
docker run -d --name grove-qdrant \\
  -p 127.0.0.1:6333:6333 \\
  -v grove-qdrant:/qdrant/storage \\
  qdrant/qdrant:latest

npm install -g @miniaxolotl/grove
grove serve`;

export const opencodeConfig = `{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"],
  "mcp": {
    "grove": {
      "type": "remote",
      "url": "http://localhost:26080/mcp"
    }
  }
}`;

export const mcpEndpoint = "http://localhost:26080/mcp";

export const firstMemory =
  'Use Grove to remember: "We use PostgreSQL for billing because we need transactions." Save it under the project "my-app".';

export const recallMemory =
  'Search Grove for "billing database" in project "my-app". What did we decide, and why?';
