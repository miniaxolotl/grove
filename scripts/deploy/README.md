# @script/deploy

Builds and pushes Docker images to GHCR and/or Docker Hub, then creates a GitHub release.

## Usage

```bash
pnpm --filter @script/deploy run deploy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GHCR_REGISTRY` | GHCR registry path (e.g., `ghcr.io/miniaxolotl`) |
| `DOCKERHUB_REGISTRY` | Docker Hub namespace (e.g., `miniaxolotl`) |
| `DOCKERHUB_TOKEN` | Docker Hub API token |
| `GH_TOKEN` | GitHub token for release creation |
| `NPM_TOKEN` | npm token for package publishing |