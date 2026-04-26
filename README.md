# grove

[![npm](https://img.shields.io/npm/v/@miniaxolotl/grove)](https://npmjs.com/package/@miniaxolotl/grove)
[![Docker Hub](https://img.shields.io/docker/v/miniaxolotl/grove?label=docker%20hub)](https://hub.docker.com/r/miniaxolotl/grove)
[![GHCR](https://img.shields.io/github/v/release/miniaxolotl/grove?label=ghcr)](https://github.com/miniaxolotl/grove/releases)
[![License](https://img.shields.io/github/license/miniaxolotl/grove)](LICENSE)

Self-hosted agentic memory MCP server backed by Qdrant. Exposes semantic memory storage, entity/relation knowledge graph, and optional reranking as MCP tools.

## Quick Start

```bash
cp .env.example .env
docker compose up -d
```

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable            | Description                 | Default                 |
| ------------------- | --------------------------- | ----------------------- |
| `QDRANT_URL`        | Qdrant server URL           | `http://localhost:6333` |
| `COLLECTION_PREFIX` | Prefix for collection names | `grove`                 |
| `EMBEDDING_MODEL`   | Embedding model             | `Xenocrat/embeddings`   |
| `RERANKING_URL`     | Reranking service URL       | (none)                  |
| `PORT`              | Server port                 | `3100`                  |

## OpenCode Plugin

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"]
}
```

Plugins are installed automatically by Bun at startup.

| Variable        | Description                       | Default                     |
| --------------- | --------------------------------- | --------------------------- |
| `GROVE_MCP_URL` | Grove MCP server URL              | `http://localhost:3100/mcp` |
| `GROVE_PROJECT` | Project name for memory filtering | (none)                      |

## MCP Server

Use Grove as a general-purpose MCP server with any MCP client.

### Docker

```bash
docker run -p 3100:3100 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  ghcr.io/miniaxolotl/grove:latest
```

### npm

```bash
npm install -g @miniaxolotl/grove
grove serve
```

### Connect to OpenCode

Add to your `opencode.json`:

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

Or for Docker:

```json
{
  "mcpServers": {
    "grove": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-p",
        "3100:3100",
        "ghcr.io/miniaxolotl/grove:latest"
      ]
    }
  }
}
```

## MCP Tools

**Memory:** `memory_save`, `memory_search`, `memory_compact`, `memory_prune`, `memory_update`, `memory_scroll`, `memory_stats`, `memory_forget`, `memory_note`

**Entities:** `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_add_observations`, `entity_update`, `entity_stats`

**Relations:** `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats`

## Documentation

- [Deployment guide](documentation/deploy/deploy.md)
- [Client/Plugin reference](documentation/client.md)
- [Server setup & deployment](documentation/server.md)

## License

MIT
