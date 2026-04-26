# Grove MCP Server - Documentation

## Overview

`@miniaxolotl/grove` is a self-hosted agentic memory MCP server backed by Qdrant, inspired by Supermemory. It provides semantic memory storage, entity/relation knowledge graphs, and optional reranking as MCP tools.

## Configuration

Configuration is loaded from environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` |
| `COLLECTION_PREFIX` | Prefix for collection names | `grove` |
| `EMBEDDING_MODEL` | Embedding model to use | `Xenocrat/embeddings` |
| `RERANKING_URL` | Reranking service URL | (none) |
| `PORT` | Server port | `3100` |

### .env Example

```
QDRANT_URL=http://localhost:6333
COLLECTION_PREFIX=grove
EMBEDDING_MODEL=Xenocrat/embeddings
RERANKING_URL=http://localhost:8080
PORT=3100
```

## Commands

### Development

```bash
pnpm dev
```

Starts the MCP server in development mode with hot reload.

### Production

```bash
pnpm build && pnpm start
```

Builds the TypeScript and starts the production server.

### Docker

```bash
docker compose up -d
```

Starts the Grove server with Qdrant and optional reranking services.

## MCP Tools

### Memory Tools

#### `memory_save`

Save a memory document to semantic storage.

```typescript
{
  information: string,      // The memory text
  metadata?: {
    source?: string,        // Source of the memory
    project?: string,       // Project association
    tags?: string[],        // Optional tags
    importance?: number,    // 0-1 importance score
    sessionId?: string,     // Session identifier
  }
}
```

#### `memory_search`

Search memories by semantic similarity with optional reranking.

```typescript
{
  query: string,            // Search query
  project?: string,         // Filter by project
  tags?: string[],          // Filter by tags
  limit?: number,           // Max results (default: 5)
  rerank?: boolean,         // Enable reranking (default: false)
  rerankTopK?: number,      // Top K for reranking (default: 20)
}
```

#### `memory_compact`

Compact memories by session or project, removing low-importance ones.

```typescript
{
  project?: string,               // Filter by project
  sessionId?: string,             // Filter by session
  importanceThreshold?: number,   // Min importance to keep (default: 0.6)
}
```

#### `memory_prune`

Delete memories below an importance threshold.

```typescript
{
  threshold: number,        // Min importance to keep
  project?: string,         // Filter by project
}
```

#### `memory_update`

Update memory text or metadata.

```typescript
{
  id: string,              // Memory ID
  text?: string,           // New text (optional)
  metadata?: {
    source?: string,
    project?: string,
    tags?: string[],
    importance?: number,
    sessionId?: string,
  }
}
```

#### `memory_delete`

Delete a specific memory by ID.

```typescript
{
  id: string               // Memory ID to delete
}
```

### Entity Tools

#### `entity_create`

Create an entity.

#### `entity_search`

Search for entities.

#### `entity_get`

Get entity details.

#### `entity_delete`

Delete an entity.

### Relation Tools

#### `relation_create`

Create a relation between entities.

#### `relation_search`

Search relations.

#### `relation_delete`

Delete a relation.

## Architecture

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│     OpenCode     │         │   Grove MCP      │         │    Qdrant        │
│     (IDE)        │◄────────│    Server        │◄────────│  (vector store)  │
└──────────────────┘  MCP    └──────────────────┘         └──────────────────┘
                                                      ┌──────────────────┐
                                                      │   Embedding      │
                                                      │   Model          │
                                                      └──────────────────┘
                                                      ┌──────────────────┐
                                                      │   Reranking      │
                                                      │   Service (opt)  │
                                                      └──────────────────┘
```

## Data Model

### Memory

```typescript
interface Memory {
  id: string;
  text: string;
  metadata: {
    source?: string;
    project?: string;
    tags?: string[];
    importance?: number;    // 0-1
    sessionId?: string;
    createdAt: string;       // ISO datetime
    updatedAt?: string;      // ISO datetime
    lastAccessedAt?: string; // ISO datetime
  };
}
```

### Entity

```typescript
interface Entity {
  id: string;
  name: string;
  entityType: string;
  observations: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}
```

### Relation

```typescript
interface Relation {
  id: string;
  from: string;           // Entity ID
  to: string;             // Entity ID
  relationType: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

## Deployment

### Docker Compose

```bash
docker compose up -d
```

This starts:
- `grove` server on port 3100
- `qdrant` on port 6333

```yaml
version: '3.8'
services:
  grove:
    image: ghcr.io/miniaxolotl/grove:latest
    ports:
      - "3100:3100"
    environment:
      - QDRANT_URL=http://qdrant:6333
    depends_on:
      - qdrant

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  qdrant_data:
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` |
| `COLLECTION_PREFIX` | Prefix for collection names | `grove` |
| `EMBEDDING_MODEL` | Embedding model name | `Xenocrat/embeddings` |
| `RERANKING_URL` | Reranking service URL | (none) |
| `PORT` | Server HTTP port | `3100` |
| `HOST` | Server host | `0.0.0.0` |

## Deploy (Docker)

See `scripts/deploy/README.md` for Docker deployment.
