# Grove MCP Server - Documentation

## Overview

`@miniaxolotl/grove` is a self-hosted agentic memory MCP server backed by Qdrant. It provides semantic memory storage, entity/relation knowledge graphs, and optional reranking as MCP tools.

## Install

### npm

```bash
npm install -g @miniaxolotl/grove
```

### pnpm

```bash
pnpm add -g @miniaxolotl/grove
```

### bun

```bash
bun add -g @miniaxolotl/grove
```

### Run Without Install

```bash
npx @miniaxolotl/grove serve
pnpm dlx @miniaxolotl/grove serve
bunx @miniaxolotl/grove serve
```

## Usage

### Start Server

```bash
grove serve
```

Or with stdio transport (for direct MCP client connections):

```bash
grove
```

### CLI Options

```
grove serve    Start the MCP server
grove          Start the MCP server (default)

Options:
  --version, -v  Show version
  --help, -h     Show this help
```

### Environment Variables

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

### .env Example

```
QDRANT_URL=http://localhost:6333
COLLECTION_PREFIX=memory
PORT=26080
```

## MCP Tools

### Memory Tools

#### `memory_save`

Save a memory document to semantic storage.

```typescript
{
  information: string,
  metadata?: {
    source?: string,
    project?: string,
    tags?: string[],
    importance?: number,
    sessionId?: string,
  }
}
```

#### `memory_search`

Search memories by semantic similarity with optional reranking.

```typescript
{
  query: string,
  project?: string,
  tags?: string[],
  limit?: number,
  rerank?: boolean,
  rerankTopK?: number,
}
```

#### `memory_scroll`

Paginate through memories with cursor-based pagination.

```typescript
{
  project?: string,
  tags?: string[],
  limit?: number,
  offset?: string,
}
```

#### `memory_update`

Update memory text or metadata.

```typescript
{
  id: string,
  text?: string,
  metadata?: {
    source?: string,
    project?: string,
    tags?: string[],
    importance?: number,
    sessionId?: string,
  }
}
```

#### `memory_forget`

Delete memories by IDs or filter.

```typescript
{
  ids?: string[],
  project?: string,
  tags?: string[],
}
```

#### `memory_compact`

Compact memories by session or project, removing low-importance ones.

```typescript
{
  project?: string,
  sessionId?: string,
  importanceThreshold?: number,
}
```

#### `memory_prune`

Delete memories below an importance threshold.

```typescript
{
  threshold: number,
  project?: string,
}
```

#### `memory_stats`

Get statistics about the memories collection.

#### `memory_note`

Quick-save a note (lightweight memory with auto-tag 'note').

```typescript
{
  content: string,
  project?: string,
  tags?: string[],
}
```

### Entity Tools

#### `entity_create`

Create an entity.

```typescript
{
  name: string,
  entityType: string,
  observations?: string[],
  metadata?: Record<string, unknown>,
}
```

#### `entity_get`

Get full entity details by name.

```typescript
{
  name: string,
}
```

#### `entity_search`

Find entities by name or type.

```typescript
{
  query?: string,
  entityType?: string,
  limit?: number,
}
```

#### `entity_list`

List all entities with pagination.

```typescript
{
  entityType?: string,
  limit?: number,
  offset?: string,
}
```

#### `entity_update`

Update an existing entity by ID.

```typescript
{
  id: string,
  name?: string,
  entityType?: string,
  metadata?: Record<string, unknown>,
}
```

#### `entity_add_observations`

Add observations to an existing entity.

```typescript
{
  name: string,
  observations: string[],
}
```

#### `entity_stats`

Get statistics about the entities collection.

### Relation Tools

#### `relation_create`

Create a relation between two entities.

```typescript
{
  from: string,
  relationType: string,
  to: string,
  metadata?: Record<string, unknown>,
}
```

#### `relation_search`

Find relations by source, target, or type.

```typescript
{
  from?: string,
  to?: string,
  relationType?: string,
  limit?: number,
}
```

#### `relation_list`

List all relations with pagination.

```typescript
{
  relationType?: string,
  limit?: number,
  offset?: string,
}
```

#### `relation_delete`

Delete relations.

```typescript
{
  from?: string,
  to?: string,
  relationType?: string,
}
```

#### `relation_stats`

Get statistics about the relations collection.

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
    importance?: number;
    sessionId?: string;
    createdAt: string;
    updatedAt?: string;
    lastAccessedAt?: string;
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
  from: string;
  to: string;
  relationType: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

## Health Checks

```bash
# Server health (always available)
curl http://localhost:26081/health

# Collections ready (returns 503 until initialized)
curl http://localhost:26081/ready
```

## Docker

```bash
docker run -p 26080:26080 -p 26081:26081 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  ghcr.io/miniaxolotl/grove:latest
```

## Deployment

See [Deployment Guide](./deploy.md) for production deployment instructions.
