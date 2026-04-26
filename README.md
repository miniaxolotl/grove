# grove

[![npm](https://img.shields.io/npm/v/@miniaxolotl/grove)](https://npmjs.com/package/@miniaxolotl/grove)
[![Docker Hub](https://img.shields.io/docker/v/miniaxolotl/grove?label=dockerhub&color=light)](https://hub.docker.com/r/miniaxolotl/grove)
[![GHCR](https://img.shields.io/github/v/release/miniaxolotl/grove?label=ghcr&color=light)](https://github.com/miniaxolotl/grove/pkgs/container/grove)
[![License](https://img.shields.io/github/license/miniaxolotl/grove)](LICENSE)

Self-hosted agentic memory MCP server backed by Qdrant.

## Quick Start

```bash
cp .env.example .env
docker compose up -d
```

Or with npm:

```bash
npm install -g @miniaxolotl/grove
grove serve
```

## OpenCode

### Plugin (Recommended)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"]
}
```

Set `GROVE_PROJECT` to your project name for filtering.

### MCP Server

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

## Tools

| Category   | Tools                                                                 |
| ----------- | --------------------------------------------------------------------- |
| **Memory**  | `memory_save`, `memory_search`, `memory_scroll`, `memory_update`, `memory_forget`, `memory_compact`, `memory_prune`, `memory_stats`, `memory_note` |
| **Entity**  | `entity_create`, `entity_get`, `entity_search`, `entity_list`, `entity_update`, `entity_add_observations`, `entity_stats` |
| **Relation**| `relation_create`, `relation_search`, `relation_list`, `relation_delete`, `relation_stats` |

## Docs

- [Server reference](documentation/server.md)
- [Plugin reference](documentation/client.md)
- [Deploy & release](documentation/deploy.md)

## License

MIT
