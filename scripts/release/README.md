# @script/release

Publishes packages to npm using Changesets.

## Usage

```bash
pnpm --filter @script/release run release
```

## Dry Run

```bash
pnpm --filter @script/release run release -- --dry-run
```

## What it does

1. Runs Changesets version bump
2. Publishes MCP package to npm
3. Publishes OpenCode plugin to npm
4. Creates GitHub release with changelog

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NPM_TOKEN` | npm token for package publishing |
| `GH_TOKEN` | GitHub token for release creation |