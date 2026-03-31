# @qdrant-memory/mcp

[![npm](https://img.shields.io/npm/v/@qdrant-memory/mcp)](https://npmjs.com/package/@qdrant-memory/mcp)
[![Docker Hub](https://img.shields.io/docker/v/miniaxolotl/qdrant-memory?label=docker%20hub)](https://hub.docker.com/r/miniaxolotl/qdrant-memory)
[![GHCR](https://img.shields.io/github/v/release/miniaxolotl/qdrant-memory?label=ghcr)](https://github.com/miniaxolotl/qdrant-memory/releases)
[![License](https://img.shields.io/npm/l/@qdrant-memory/mcp)](LICENSE)

Self-hosted agentic memory MCP server backed by Qdrant vector database. Provides semantic memory storage, entity/relation knowledge graph, and optional reranking as MCP tools for AI agents.

## Features

- **Semantic Memory** — Store and search memories with vector embeddings
- **Knowledge Graph** — Entity/relation graph for structured knowledge
- **Local Embeddings** — Uses ONNX models (no external API needed)
- **Remote Embeddings** — OpenAI-compatible API support
- **Optional Reranking** — Cross-encoder reranking for better results
- **HTTP Transport** — Run as a server or via stdio
- **Health Checks** — Built-in `/health` and `/ready` endpoints

## Installation

```bash
npm install @qdrant-memory/mcp
```

## Quick Start

### 1. Start Qdrant

```bash
docker run -p 6333:6333 qdrant/qdrant
```

### 2. Run the server

```bash
npx @qdrant-memory/mcp
```

Or via code:

```typescript
import { server } from "@qdrant-memory/mcp";

// Start with HTTP transport (default port 26080)
server.run({ transport: "http" });

// Or stdio for Claude Desktop
server.run({ transport: "stdio" });
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | — | Qdrant API key |
| `TRANSPORT` | `http` | `stdio` or `http` |
| `PORT` | `26080` | HTTP server port |
| `COLLECTION_PREFIX` | `memory` | Prefix for collection names |
| `EMBEDDING_URL` | — | Remote embedding URL (OpenAI-compatible) |
| `EMBEDDING_MODEL` | — | Model name for remote embedding |
| `RERANKING_URL` | — | Remote reranking URL |
| `RERANKING_MODEL` | — | Model name for reranking |

### Local Embeddings

By default, uses `Xenova/all-MiniLM-L6-v2` via ONNX — no external service required.

## MCP Tools

### Memory

- `memory_save` — Save a memory
- `memory_search` — Search memories by similarity
- `memory_save_batch` — Save multiple memories
- `memory_search_batch` — Batch search
- `memory_update` — Update a memory
- `memory_get` — Get a memory by ID
- `memory_forget` — Delete memories
- `memory_scroll` — List memories with pagination
- `memory_stats` — Get memory statistics
- `memory_export` / `memory_import` — Backup/restore

### Entities

- `entity_create` — Create an entity
- `entity_get` — Get entity by name
- `entity_search` — Search entities
- `entity_list` — List all entities
- `entity_add_observations` — Add observations
- `entity_update` — Update entity

### Relations

- `relation_create` — Create a relation
- `relation_search` — Search relations
- `relation_list` — List relations
- `relation_delete` — Delete a relation

## Docker

```bash
docker run -e QDRANT_URL=http://host.docker.internal:6333 \
           -p 26080:26080 \
           ghcr.io/miniaxolotl/qdrant-memory
```

Or use `docker-compose.yml` from the repo for full stack.

## License

MIT
