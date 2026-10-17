# Grove

Self-hosted memory for AI agents, by **Bramble Labs Inc.**

Grove is an MCP server for semantic memory, knowledge graphs, and persistent
project context. It uses Qdrant for storage and local embeddings by default.

[Website](https://grove-six-rosy.vercel.app) · [Installation](https://grove-six-rosy.vercel.app/install) · [Tool reference](documentation/server.md)

## Quick start

From a clone of this repository, start Grove and Qdrant with Docker:

```bash
cp .env.example .env
docker compose up -d
```

Connect your MCP client to `http://localhost:26080/mcp`. Your agent can then save
decisions, search related memories, and connect entities across sessions.
See the [OpenCode integration](documentation/client.md) for plugin setup.

## Website development

Requires Node.js 22+ and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm dev:website
```

The marketing site runs at `http://localhost:3000`. See the
[website guide](packages/website/README.md) for builds and checks, and the
[deployment reference](documentation/deploy.md) for server hosting.

## License

[MIT](LICENSE)
