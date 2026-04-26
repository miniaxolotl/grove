# grove

Self-hosted agentic memory MCP server backed by Qdrant.

## Quick Start

```bash
cp .env.example .env
docker compose up -d
```

## Install

```bash
npm install -g @miniaxolotl/grove   # or pnpm add -g, bun add -g
grove serve
```

Or run without installing: `npx @miniaxolotl/grove serve`

## Connect to OpenCode

### Plugin (Recommended)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"]
}
```

### MCP Server

```json
{
  "mcpServers": {
    "grove": {
      "command": "grove",
      "args": ["serve"]
    }
  }
}
```

## Configuration

| Variable            | Default                 |
| ------------------- | ----------------------- |
| `QDRANT_URL`        | `http://localhost:6333` |
| `PORT`              | `26080`                 |
| `COLLECTION_PREFIX` | `memory`                |
| `EMBEDDING_URL`     | (local ONNX)            |

Full list in `.env.example`.

## MCP Tools

**Memory:** `memory_save`, `memory_search`, `memory_scroll`, `memory_update`, `memory_forget`, `memory_compact`, `memory_prune`, `memory_stats`, `memory_note`

**Entity:** `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_update`, `entity_add_observations`, `entity_stats`

**Relation:** `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats`

## Documentation

- [Server reference](documentation/server.md)
- [Deploy & release](documentation/deploy.md)
- [Plugin reference](documentation/client.md)

## License

MIT
