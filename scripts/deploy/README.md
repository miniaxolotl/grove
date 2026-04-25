# @script/deploy

Builds and pushes Docker images to GHCR and/or Docker Hub, then creates a GitHub release.

```bash
GHCR_REGISTRY=ghcr.io/miniaxolotl DOCKERHUB_REGISTRY=miniaxolotl TAG=v0.1.0 \
  pnpm --filter @script/deploy run deploy
```
