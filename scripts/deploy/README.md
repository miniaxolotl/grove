# @script/deploy

Local Docker build and push script for development. CI handles production deploys.

## Usage

```bash
GHCR_REGISTRY=ghcr.io/miniaxolotl DOCKERHUB_REGISTRY=miniaxolotl pnpm --filter @script/deploy run deploy
```

## Environment Variables

| Variable             | Description                                      |
| -------------------- | ------------------------------------------------ |
| `GHCR_REGISTRY`      | GHCR registry path (e.g., `ghcr.io/miniaxolotl`) |
| `DOCKERHUB_REGISTRY` | Docker Hub namespace (e.g., `miniaxolotl`)       |

## CI

Image publication is handled by `.github/workflows/deploy.yml` on pushes to
`development` and `production`, or manual dispatch. Only the production branch
rolls out to DigitalOcean, using the published digest and `DIGITALOCEAN_APP_ID`.
The rollout preserves the provider's encrypted runtime secrets.

Initial App Platform provisioning uses `.do/app.json` through
`node scripts/deploy-digitalocean.mjs --create --wait`; see the
[hosting runbook](../../documentation/deploy.md) for credentials and validation.
