# grove

[![npm](https://img.shields.io/npm/v/@miniaxolotl/grove)](https://npmjs.com/package/@miniaxolotl/grove)
[![Docker Hub](https://img.shields.io/docker/v/miniaxolotl/grove?label=docker%20hub)](https://hub.docker.com/r/miniaxolotl/grove)
[![GHCR](https://img.shields.io/github/v/release/miniaxolotl/grove?label=ghcr)](https://github.com/miniaxolotl/grove/releases)
[![License](https://img.shields.io/github/license/miniaxolotl/grove)](LICENSE)

Self-hosted agentic memory MCP server backed by Qdrant. Provides semantic memory storage, entity/relation knowledge graph, and optional reranking as MCP tools.

## Install

```bash
# npm
npm install -g @miniaxolotl/grove

# pnpm
pnpm add -g @miniaxolotl/grove

# bun
bun add -g @miniaxolotl/grove

# Docker
docker pull ghcr.io/miniaxolotl/grove:latest
```

Run without installing:

```bash
npx @miniaxolotl/grove serve
pnpm dlx @miniaxolotl/grove serve
bunx @miniaxolotl/grove serve
```

## Quick Start

### Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

### Global Install

```bash
grove serve
```

## Configuration

| Variable            | Description                 | Default                 |
| ------------------- | --------------------------- | ----------------------- |
| `PORT`              | Server port                 | `26080`                 |
| `TRANSPORT`         | `http` or `stdio`           | `http`                  |
| `QDRANT_URL`        | Qdrant server URL           | `http://localhost:6333` |
| `QDRANT_API_KEY`    | Qdrant API key              | (none)                  |
| `COLLECTION_PREFIX` | Prefix for collection names | `memory`                |
| `VECTOR_DIM`        | Embedding dimension         | `384`                   |
| `EMBEDDING_URL`     | Remote embedding URL        | (uses local ONNX)       |
| `RERANKING_URL`     | Remote reranking URL        | (disabled)              |

## Connect to OpenCode

### Via Plugin (Recommended)

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"]
}
```

| Variable        | Description                       | Default                      |
| --------------- | --------------------------------- | ---------------------------- |
| `GROVE_MCP_URL` | Grove MCP server URL              | `http://localhost:26080/mcp` |
| `GROVE_PROJECT` | Project name for memory filtering | (none)                       |

### Via MCP Server

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

Or via Docker:

```json
{
  "mcpServers": {
    "grove": {
      "command": "docker",
      "args": ["run", "--rm", "-p", "26080:26080", "ghcr.io/miniaxolotl/grove:latest"]
    }
  }
}
```

## MCP Tools

| Category   | Tools                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Memory** | `memory_save`, `memory_search`, `memory_scroll`, `memory_update`, `memory_forget`, `memory_compact`, `memory_prune`, `memory_stats`, `memory_note` |
| **Entity** | `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_update`, `entity_add_observations`, `entity_stats` |
| **Relation** | `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats`                             |

## Documentation

- [Server reference](documentation/server.md) — full tool parameters, data model, architecture
- [Deploy & release guide](documentation/deploy.md) — production deploy, CI/CD, release-please
- [Plugin reference](documentation/client.md) — OpenCode plugin configuration and hooks

## License

MIT
