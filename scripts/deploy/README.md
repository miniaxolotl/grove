# @script/deploy

Local Docker build and push script for development. CI handles production deploys.

## Usage

```bash
GHCR_REGISTRY=ghcr.io/miniaxolotl DOCKERHUB_REGISTRY=miniaxolotl pnpm --filter @script/deploy run deploy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GHCR_REGISTRY` | GHCR registry path (e.g., `ghcr.io/miniaxolotl`) |
| `DOCKERHUB_REGISTRY` | Docker Hub namespace (e.g., `miniaxolotl`) |

## CI

Production deploys are handled by `.github/workflows/deploy.yml` which triggers on `grove-v*` tags (created by release-please).
