# grove

[![npm](https://img.shields.io/npm/v/@miniaxolotl/grove)](https://npmjs.com/package/@miniaxolotl/grove)
[![Docker Hub](https://img.shields.io/docker/v/miniaxolotl/grove?label=docker%20hub)](https://hub.docker.com/r/miniaxolotl/grove)
[![GHCR](https://img.shields.io/github/v/release/miniaxolotl/grove?label=ghcr)](https://github.com/miniaxolotl/grove/releases)
[![License](https://img.shields.io/github/license/miniaxolotl/grove)](LICENSE)

Self-hosted agentic memory MCP server backed by Qdrant. Exposes semantic memory storage, entity/relation knowledge graph, and optional reranking as MCP tools.

## Server

```bash
cp .env.example .env
docker compose up -d
```

## OpenCode Plugin

The Grove OpenCode plugin (`@minimaxolotl/grove-opencode-plugin`) captures memories, injects hot context, and manages memory importance tiers.

```bash
npm install @minimaxolotl/grove-opencode-plugin
```

Configure via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `GROVE_MCP_URL` | Grove MCP server URL | `http://localhost:3100/mcp` |
| `GROVE_PROJECT` | Project name for memory filtering | (none) |

## MCP Tools

**Memory:** `memory_save`, `memory_search`, `memory_compact`, `memory_prune`, `memory_update`, `memory_scroll`, `memory_stats`, `memory_forget`, `memory_note`

**Entities:** `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_add_observations`, `entity_update`, `entity_stats`

**Relations:** `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats`

## Local Dev

```bash
docker compose up -d
pnpm install
pnpm run dev:setup
pnpm run dev
```

## Deploy

See `documentation/server.md` for deployment and configuration options.

## Documentation

- [Client/Plugin reference](documentation/client.md)
- [Server setup & deployment](documentation/server.md)

## License

MIT
