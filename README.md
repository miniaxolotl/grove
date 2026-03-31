# qdrant-memory

![npm](https://img.shields.io/npm/v/@qdrant-memory/server)
![Docker Hub](https://img.shields.io/docker/v/miniaxolotl/qdrant-memory?label=docker%20hub)
![GHCR](https://img.shields.io/github/v/release/miniaxolotl/qdrant-memory?label=ghcr)

Self-hosted agentic memory MCP server backed by Qdrant. Exposes semantic memory storage, entity/relation knowledge graph, and optional reranking as MCP tools.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm run setup
pnpm run dev
```

## Docker

### Full stack (server + Qdrant)

```bash
docker compose up -d
```

### From Docker Hub

```bash
docker run -e QDRANT_URL=https://your-qdrant.cloud \
           -e QDRANT_API_KEY=your-key \
           -p 26080:26080 \
           miniaxolotl/qdrant-memory
```

### From GHCR

```bash
docker run -e QDRANT_URL=https://your-qdrant.cloud \
           -e QDRANT_API_KEY=your-key \
           -p 26080:26080 \
           ghcr.io/miniaxolotl/qdrant-memory
```

## Configuration

| Variable               | Default                 | Description                                             |
| ---------------------- | ----------------------- | ------------------------------------------------------- |
| `QDRANT_URL`           | `http://localhost:6333` | Qdrant server URL                                       |
| `QDRANT_API_KEY`       | —                       | Qdrant API key                                          |
| `COLLECTION_PREFIX`    | `memory`                | Prefix for collection names                             |
| `VECTOR_DIM`           | `384`                   | Auto-detected from embedding config                     |
| `TRANSPORT`            | `http`                  | `stdio` or `http`                                       |
| `PORT`                 | `26080`                 | HTTP port                                               |
| `EMBEDDING_URL`        | —                       | Remote embedding URL. Falls back to local ONNX if unset |
| `EMBEDDING_MODEL`      | —                       | Model name for remote embedding only                    |
| `EMBEDDING_BATCH_SIZE` | `10`                    | Embedding request batch size                            |
| `EMBEDDING_MAX_TOKENS` | `512`                   | Max tokens per text                                     |
| `RERANKING_URL`        | —                       | Remote reranking URL. Disabled if unset                 |
| `RERANKING_MODEL`      | —                       | Model name for remote reranking only                    |

### Local embedding (default)

When `EMBEDDING_URL` is unset, the server embeds locally using `Xenova/all-MiniLM-L6-v2` via ONNX — no external service needed.

## Tools

**Memory:** `memory_save`, `memory_save_batch`, `memory_search`, `memory_search_batch`, `memory_update`, `memory_get`, `memory_forget`, `memory_scroll`, `memory_stats`, `memory_export`, `memory_import`, `memory_note`, `memory_notes`

**Entities:** `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_add_observations`, `entity_update`, `entity_stats`

**Relations:** `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats`

## License

MIT
