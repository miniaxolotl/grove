# qdrant-memory

Self-hosted agentic memory MCP server backed by Qdrant. Exposes semantic memory storage, entity/relation knowledge graph, and optional reranking as MCP tools.

## Features

- Semantic memory with vector embeddings (remote or local ONNX)
- Entity/relation knowledge graph
- Batch save/search, cursor-based pagination, import/export
- Optional cross-encoder reranking
- stdio or HTTP transport

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with QDRANT_URL and QDRANT_API_KEY
npm run setup
npm run dev
```

## Docker

```bash
# Full stack (MCP server + local Qdrant)
docker compose up -d

# HTTP transport (accessible at http://localhost:3001/mcp)
docker compose up -d qdrant-memory-http

# Standalone with external Qdrant
docker build -t qdrant-memory .
docker run -e QDRANT_URL=https://your-qdrant.cloud \
           -e QDRANT_API_KEY=your-key \
           -e TRANSPORT=http -p 26080:26080 \
           qdrant-memory
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | — | Qdrant API key |
| `COLLECTION_PREFIX` | `memory` | Prefix for collection names |
| `VECTOR_DIM` | `384` / `1024` | Auto-detected from embedding config |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3001` | HTTP port |
| `EMBEDDING_URL` | — | Remote embedding URL (OpenAI-compatible). Falls back to local ONNX if unset |
| `EMBEDDING_MODEL` | `bge-m3` | Remote embedding model name |
| `EMBEDDING_BATCH_SIZE` | `10` | Embedding request batch size |
| `EMBEDDING_MAX_TOKENS` | `512` | Max tokens per text |
| `RERANKING_URL` | — | Remote reranking URL. Disabled if unset |
| `RERANKING_MODEL` | `bge-reranker-v2-m3` | Reranking model name |

## Tools

**Memory:** `memory_save`, `memory_save_batch`, `memory_search`, `memory_search_batch`, `memory_update`, `memory_get`, `memory_forget`, `memory_scroll`, `memory_stats`, `memory_export`, `memory_import`, `memory_note`, `memory_notes`

**Entities:** `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_add_observations`, `entity_update`, `entity_stats`

**Relations:** `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats`

## Usage

### Save and search

```json
{"information": "The project uses TypeScript with strict mode", "metadata": {"project": "my-app", "tags": ["tech-stack"]}}
{"query": "what language does the project use?", "project": "my-app"}
```

### Knowledge graph

```json
{"name": "Qdrant", "entityType": "database", "observations": ["Vector database", "Written in Rust"]}
{"from": "Qdrant", "relationType": "used_by", "to": "qdrant-memory"}
{"from": "Qdrant"}
```

### Batch and pagination

```json
{"items": [{"information": "Deployed v2.1", "metadata": {"tags": ["deploy"]}}, {"information": "Migration v42 applied"}]}
{"limit": 50}
{"limit": 50, "offset": "abc123"}
```

## License

MIT
