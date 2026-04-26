# Grove OpenCode Plugin - Client Documentation

## Overview

The `grove-opencode-plugin` is an OpenCode plugin that captures memories, injects hot context, and manages memory importance tiers for the Grove MCP server.

## Configuration

Configuration is loaded from environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `GROVE_MCP_URL` | Grove MCP server URL | `http://localhost:3100/mcp` |
| `GROVE_PROJECT` | Project name for memory filtering | (none) |

### Environment Variables Example

```bash
GROVE_MCP_URL=http://localhost:3100/mcp
GROVE_PROJECT=my-project
```

## Features

### Memory Capture

The plugin automatically captures memories from tool executions:

- **Source tracking** - Records which tool/source created each memory
- **Project tagging** - Associates memories with specific projects
- **Importance scoring** - Assigns importance scores to memories
- **Session tracking** - Groups memories by session

### Context Injection

Injects relevant memories as hot context into OpenCode sessions:

- Searches memories semantically based on current context
- Reranks results for relevance
- Injects top memories into the prompt

### Importance Management

Automatically manages memory importance tiers:

- **Decay** - Importance decays over time for unaccessed memories
- **Threshold pruning** - Memories below importance threshold are pruned
- **Session compaction** - Low-importance memories within a session are compacted

## Hooks

### `tool.execute.after`

Executed after each tool call. Captures memories and updates importance.

### `experimental.session.compacting`

Session-level compaction hook for managing memory lifecycle.

## Memory Schema

Memories stored with the following metadata:

```typescript
interface MemoryMetadata {
  source?: string;        // Tool or source that created the memory
  project?: string;       // Project association
  tags?: string[];        // Optional tags
  importance?: number;    // 0-1 importance score
  sessionId?: string;    // Session identifier
  createdAt?: string;    // ISO datetime
  updatedAt?: string;    // ISO datetime
  lastAccessedAt?: string; // ISO datetime
}
```

## MCP Tools Used

The plugin calls these Grove MCP tools:

| Tool | Description |
|------|-------------|
| `memory_save` | Save a new memory |
| `memory_search` | Search memories by semantic similarity |
| `memory_compact` | Compact memories by session/project |
| `memory_prune` | Delete memories below threshold |
| `memory_update` | Update memory text or metadata |

## Architecture

```
┌─────────────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│      OpenCode           │         │  grove-opencode  │         │    Grove MCP      │
│      (IDE)              │◄────────│    -plugin       │◄────────│    Server        │
└─────────────────────────┘         └──────────────────┘         └──────────────────┘
        │                                    │                            │
        │ tool.execute.after hook            │ JSON-RPC over HTTP          │
        │ ─────────────────────────────────►│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►│
        │                                    │                             │
        │                                    │ ┌───────────────────────────┴──► Qdrant
        │◄───────────────────────────────── │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ►│ (vector store)
        │    memory context injection        │    memory operations          │
        └────────────────────────────────────┘
```

## Installation

The plugin is published as `@minimaxolotl/grove-opencode-plugin` on npm.

```bash
npm install @minimaxolotl/grove-opencode-plugin
```

## Development

```bash
# Build
pnpm run build

# Watch mode
pnpm run dev

# Publish to npm
pnpm run publish
```
