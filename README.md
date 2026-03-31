# qdrant-memory

Self-hosted agentic memory MCP server backed by [Qdrant](https://qdrant.tech/) vector database. Provides semantic memory storage, entity/relation knowledge graph management, and optional reranking — all exposed as [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) tools.

## Features

- **Semantic memory** — save, search, update, and delete memories with vector embeddings
- **Entity graph** — create entities with observations, link them via typed relations
- **Batch operations** — save/search multiple memories in a single call
- **Pagination** — cursor-based scroll for large datasets
- **Import/export** — full JSON export and import of memories
- **Reranking** — optional cross-encoder reranking for higher-quality search results
- **Dual transport** — stdio (for local MCP clients) or HTTP streaming (for remote clients)
- **Flexible embeddings** — remote embedding service (OpenAI-compatible API) or local ONNX model via `@huggingface/transformers`
- **Docker-ready** — includes `docker-compose.yml` with optional local Qdrant

## Tools

| Tool | Description |
|------|-------------|
| `memory_save` | Save a single memory |
| `memory_save_batch` | Save multiple memories at once |
| `memory_search` | Semantic search with optional reranking |
| `memory_search_batch` | Search multiple queries at once |
| `memory_update` | Update text or metadata of a memory |
| `memory_get` | Get a single memory by ID |
| `memory_forget` | Delete memories by IDs or filter |
| `memory_scroll` | Paginate through memories |
| `memory_stats` | Collection statistics |
| `memory_export` | Export all memories as JSON |
| `memory_import` | Import memories from JSON |
| `memory_note` | Quick-save a note (auto-tagged) |
| `memory_notes` | Batch save notes |
| `entity_create` | Create a named entity |
| `entity_get` | Get entity details by name |
| `entity_search` | Find entities by name or type |
| `entity_list` | List entities with pagination |
| `entity_add_observations` | Append observations to an entity |
| `entity_update` | Update entity fields |
| `entity_stats` | Entity collection statistics |
| `relation_create` | Create a typed relation between entities |
| `relation_search` | Find relations by source/target/type |
| `relation_list` | List relations with pagination |
| `relation_delete` | Delete relations by filter |
| `relation_stats` | Relation collection statistics |

## Quick Start

### Prerequisites

- Node.js 22+
- A running Qdrant instance (v1.12+)

### Local Development

```bash
# Clone and install
git clone https://github.com/your-username/qdrant-memory.git
cd qdrant-memory
npm install

# Configure
cp .env.example .env
# Edit .env with your Qdrant URL and API key

# Setup collections
npm run setup

# Run in dev mode
npm run dev

# Build and run
npm run build
npm start
```

### Docker

```bash
# With docker-compose (includes local Qdrant)
docker compose up -d

# Or build and run manually
docker build -t qdrant-memory .
docker run -e QDRANT_URL=http://host:6333 \
           -e QDRANT_API_KEY=your-key \
           qdrant-memory
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | *(empty)* | Qdrant API key |
| `COLLECTION_PREFIX` | `memory` | Prefix for Qdrant collection names |
| `VECTOR_DIM` | `384` or `1024` | Vector dimension (auto-detects from embedding config) |
| `TRANSPORT` | `stdio` | `stdio` for local MCP, `http` for remote |
| `PORT` | `3001` | HTTP port (when `TRANSPORT=http`) |
| `EMBEDDING_URL` | *(empty)* | Remote embedding service URL (OpenAI-compatible). Falls back to local ONNX model if unset. |
| `EMBEDDING_MODEL` | `bge-m3` | Model name for remote embedding |
| `EMBEDDING_BATCH_SIZE` | `10` | Batch size for embedding requests |
| `EMBEDDING_MAX_TOKENS` | `512` | Max tokens per text before truncation |
| `RERANKING_URL` | *(empty)* | Remote reranking service URL. Reranking is disabled if unset. |
| `RERANKING_MODEL` | `bge-reranker-v2-m3` | Model name for reranking |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  MCP Client │────▶│  qdrant-     │────▶│   Qdrant     │
│  (Claude,   │     │  memory      │     │   (vectors)  │
│   Cursor)   │◀────│  MCP Server  │◀────│              │
└─────────────┘     └──────────────┘     └──────────────┘
                           │
                    ┌──────┴──────┐
                    │ Embedding   │  (remote or local ONNX)
                    │ Reranking   │  (optional remote)
                    └─────────────┘
```

## License

MIT
