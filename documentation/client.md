# Grove OpenCode Plugin

## Overview

`@miniaxolotl/grove-opencode-plugin` captures memories, injects context, and manages importance tiers for the Grove MCP server.

## Configuration

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

## Features

**Memory Capture** — Automatically captures memories from tool executions with source tracking, project tagging, importance scoring, and session grouping.

**Context Injection** — Searches memories semantically, reranks results, and injects top memories into the prompt.

**Importance Management** — Importance decays over time for unaccessed memories. Low-importance memories are pruned or compacted.

## Hooks

| Hook | Description |
| ---- | ----------- |
| `tool.execute.after` | Captures memories and updates importance after each tool call |
| `experimental.session.compacting` | Session-level compaction for memory lifecycle management |

## MCP Tools Used

| Tool | Description |
| ---- | ----------- |
| `memory_save` | Save a new memory |
| `memory_search` | Search by semantic similarity |
| `memory_compact` | Compact by session/project |
| `memory_prune` | Delete below threshold |
| `memory_update` | Update text or metadata |

## Memory Metadata

```typescript
interface MemoryMetadata {
  source?: string;
  project?: string;
  tags?: string[];
  importance?: number;
  sessionId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAccessedAt?: string;
}
```

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
