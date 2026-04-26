# @script/setup

Initializes Qdrant collections required by the Grove MCP server.

## Usage

```bash
pnpm run dev:setup
```

Or from monorepo root:

```bash
pnpm --filter @script/setup run setup
```

## What it does

- Creates Qdrant collections for memories, entities, and relations
- Configures vector field schemas based on embedding model