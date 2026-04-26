# Grove OpenCode Plugin

## Overview

`@miniaxolotl/grove-opencode-plugin` captures memories from tool executions, injects relevant context into prompts, and manages importance tiers for the Grove MCP server.

## Use

Add to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"]
}
```

### Environment Variables

| Variable        | Description                       | Default                      |
| --------------- | --------------------------------- | ---------------------------- |
| `GROVE_MCP_URL` | Grove MCP server URL              | `http://localhost:26080/mcp` |
| `GROVE_PROJECT` | Project name for memory filtering | (none)                       |

## Features

**Memory Capture** — Automatically captures memories from tool executions with source tracking, project tagging, importance scoring, and session grouping.

**Context Injection** — Searches memories semantically, reranks results, and injects top memories into the prompt.

**Importance Management** — Importance decays over time for unaccessed memories. Low-importance memories are pruned or compacted.

## Hooks

| Hook                            | Description                                              |
| ------------------------------- | -------------------------------------------------------- |
| `tool.execute.after`             | Captures memories and updates importance after each tool call |
| `experimental.session.compacting` | Session-level compaction for memory lifecycle management |

## MCP Tools Used

| Tool             | Description                   |
| ---------------- | ----------------------------- |
| `memory_save`    | Save a new memory             |
| `memory_search`  | Search by semantic similarity |
| `memory_compact` | Compact by session/project    |
| `memory_prune`   | Delete below threshold        |
| `memory_update`  | Update text or metadata       |
| `memory_get`     | Retrieve a memory by ID        |

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
┌──────────────────┐         ┌───────────────────┐         ┌──────────────────┐
│     OpenCode     │──────────│ grove-opencode    │─────────│   Grove MCP     │
│                  │  hooks   │ -plugin           │ JSON-RPC│   Server        │
└──────────────────┘          └───────────────────┘         └──────────────────┘
                                                                        │
                                                                   ┌─────▼─────┐
                                                                   │  Qdrant   │
                                                                   └───────────┘
```
