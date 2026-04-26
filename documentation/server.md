# Grove MCP Server

## Overview

`@miniaxolotl/grove` is a self-hosted agentic memory MCP server backed by Qdrant. It provides semantic memory storage, entity/relation knowledge graphs, and optional reranking as MCP tools.

## Usage

```bash
grove serve          # HTTP transport (default)
grove                # stdio transport (for direct MCP clients)
grove --version      # Show version
grove --help         # Show help
```

## OpenCode Configuration

### Remote (Recommended)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "grove": {
      "type": "remote",
      "url": "http://localhost:26080/mcp"
    }
  }
}
```

### Local

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "grove": {
      "type": "local",
      "command": ["grove"]
    }
  }
}
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

## MCP Tools

### Memory

| Tool               | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `memory_save`      | Save a memory to semantic storage                    |
| `memory_search`    | Search by semantic similarity with optional reranking |
| `memory_scroll`    | Paginate through memories                            |
| `memory_update`    | Update memory text or metadata                       |
| `memory_forget`    | Delete memories by ID or filter                      |
| `memory_compact`   | Remove low-importance memories by session/project     |
| `memory_prune`     | Delete memories below importance threshold           |
| `memory_stats`     | Collection statistics                                |
| `memory_note`      | Quick-save a note (auto-tagged `note`)               |

### Entity

| Tool                    | Description                        |
| ----------------------- | ---------------------------------- |
| `entity_create`         | Create an entity                   |
| `entity_get`            | Get entity details by name          |
| `entity_search`         | Find entities by name or type       |
| `entity_list`           | List entities with pagination       |
| `entity_update`         | Update entity by ID                 |
| `entity_add_observations` | Add observations to an entity     |
| `entity_stats`          | Collection statistics               |

### Relation

| Tool                 | Description                        |
| -------------------- | ---------------------------------- |
| `relation_create`    | Create a relation between entities |
| `relation_search`    | Find relations by source/target/type |
| `relation_list`      | List relations with pagination      |
| `relation_delete`    | Delete relations                   |
| `relation_stats`     | Collection statistics              |

## Tool Parameters

### memory_save

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

### memory_search

```typescript
{
  query: string,
  project?: string,
  tags?: string[],
  limit?: number,       // default: 5
  rerank?: boolean,     // default: false
  rerankTopK?: number,  // default: 20
}
```

### memory_scroll

```typescript
{
  project?: string,
  tags?: string[],
  limit?: number,       // default: 100
  offset?: string,
}
```

### memory_update

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

### memory_forget

```typescript
{
  ids?: string[],
  project?: string,
  tags?: string[],
}
```

### memory_compact

```typescript
{
  project?: string,
  sessionId?: string,
  importanceThreshold?: number,  // default: 0.6
}
```

### memory_prune

```typescript
{
  threshold: number,
  project?: string,
}
```

### memory_note

```typescript
{
  content: string,
  project?: string,
  tags?: string[],
}
```

### entity_create

```typescript
{
  name: string,
  entityType: string,
  observations?: string[],
  metadata?: Record<string, unknown>,
}
```

### entity_get

```typescript
{ name: string }
```

### entity_search

```typescript
{
  query?: string,
  entityType?: string,
  limit?: number,  // default: 10
}
```

### entity_list

```typescript
{
  entityType?: string,
  limit?: number,   // default: 100
  offset?: string,
}
```

### entity_update

```typescript
{
  id: string,
  name?: string,
  entityType?: string,
  metadata?: Record<string, unknown>,
}
```

### entity_add_observations

```typescript
{
  name: string,
  observations: string[],
}
```

### relation_create

```typescript
{
  from: string,
  relationType: string,
  to: string,
  metadata?: Record<string, unknown>,
}
```

### relation_search

```typescript
{
  from?: string,
  to?: string,
  relationType?: string,
  limit?: number,  // default: 20
}
```

### relation_list

```typescript
{
  relationType?: string,
  limit?: number,   // default: 100
  offset?: string,
}
```

### relation_delete

```typescript
{
  from?: string,
  to?: string,
  relationType?: string,
}
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
                                                        │   Service (opt)   │
                                                        └──────────────────┘
```

## Health Checks

```bash
curl http://localhost:26081/health   # Server health
curl http://localhost:26081/ready    # Collections ready (503 until initialized)
```

## Deployment

See [Deploy & Release Guide](./deploy.md) for production deployment.
