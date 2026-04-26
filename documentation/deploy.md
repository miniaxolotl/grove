# Grove Deployment & Release Guide

Manual guide for deploying Grove MCP server and managing releases.

## Releases

Grove uses [release-please](https://github.com/googleapis/release-please) for automated versioning and releases.

### How It Works

1. Push conventional commits to `production` branch
2. Release-please creates a release PR with version bumps and changelogs
3. Merge the PR → GitHub releases and tags are created
4. npm packages are published automatically

### Conventional Commits

Use these prefixes in your commit messages:

| Prefix    | Effect                         |
| --------- | ------------------------------ |
| `feat:`   | Minor version bump             |
| `fix:`    | Patch version bump             |
| `BREAKING CHANGE:` | Major version bump    |
| `docs:`   | Documentation (no version bump)|
| `refactor:` | Code refactoring (no bump)   |
| `chore:`  | Maintenance (no bump)          |

Examples:
```bash
git commit -m "feat: add memory_compact tool"
git commit -m "fix: handle empty search results"
git commit -m "docs: update README with new config options"
```

### Manual Release

Trigger via GitHub Actions:
1. Go to Actions → Release
2. Click "Run workflow"
3. Select the `production` branch

### Release-please Config

- Config: `release-please-config.json`
- Manifest: `.release-please-manifest.json`
- Packages: `packages/mcp` (grove), `packages/grove-opencode-plugin`

## Deploy

### Docker Compose (Recommended)

```bash
cp .env.example .env
docker compose up -d
```

### Docker Image

```bash
# From GHCR
docker run -p 26080:26080 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  ghcr.io/miniaxolotl/grove:latest

# From Docker Hub
docker run -p 26080:26080 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  miniaxolotl/grove:latest
```

### npm Global Install

```bash
npm install -g @miniaxolotl/grove
grove serve
```

### npx (No Install)

```bash
npx @miniaxolotl/grove serve
```

### pnpm

```bash
pnpm add -g @miniaxolotl/grove
grove serve
# or without install
pnpm dlx @miniaxolotl/grove serve
```

### bun

```bash
bun add -g @miniaxolotl/grove
grove serve
# or without install
bunx @miniaxolotl/grove serve
```

### Manual Build

```bash
git clone https://github.com/miniaxolotl/grove.git
cd grove
pnpm install
pnpm build
pnpm start
```

### Systemd Service

Create `/etc/systemd/system/grove.service`:

```ini
[Unit]
Description=Grove MCP Server
After=network.target qdrant.service

[Service]
Type=simple
User=grove
WorkingDirectory=/opt/grove
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production
Environment=QDRANT_URL=http://localhost:6333
Environment=PORT=26080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable grove
sudo systemctl start grove
sudo systemctl status grove
```

## CI/CD Workflows

### Release (`.github/workflows/release.yml`)

Triggers on push to `production`:
1. Creates/updates release PR with version bumps
2. On merge: creates GitHub releases + tags
3. Publishes packages to npm

### Deploy (`.github/workflows/deploy.yml`)

Triggers on `grove-v*` tags:
1. Builds Docker image
2. Pushes to GHCR (`ghcr.io/miniaxolotl/grove`)
3. Pushes to Docker Hub (`miniaxolotl/grove`)

### CI (`.github/workflows/ci.yml`)

Triggers on push/PR to `production` and `development`:
1. Lint
2. Build
3. Test (with Qdrant service)

## Environment Variables

| Variable            | Description                 | Default                 |
| ------------------- | --------------------------- | ----------------------- |
| `PORT`              | Server port                 | `26080`                 |
| `TRANSPORT`         | `http` or `stdio`           | `http`                  |
| `QDRANT_URL`        | Qdrant server URL           | `http://localhost:6333` |
| `QDRANT_API_KEY`    | Qdrant API key              | (none)                  |
| `COLLECTION_PREFIX` | Prefix for collection names | `memory`                |
| `VECTOR_DIM`        | Embedding dimension         | `384`                   |
| `EMBEDDING_URL`     | Remote embedding URL        | (uses local ONNX)       |
| `RERANKING_URL`     | Remote reranking URL        | (disabled)              |

## Health Checks

```bash
# Server health
curl http://localhost:26081/health

# Collections ready
curl http://localhost:26081/ready
```

## Reverse Proxy

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name grove.example.com;

    ssl_certificate /etc/letsencrypt/live/grove.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/grove.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:26080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location /health {
        proxy_pass http://127.0.0.1:26081/health;
        proxy_set_header Host $host;
    }
}
```

### Caddy

```caddy
grove.example.com {
    reverse_proxy localhost:26080
}
```

## Updating

```bash
# Docker
docker pull ghcr.io/miniaxolotl/grove:latest
docker compose down && docker compose up -d

# npm
npm update -g @miniaxolotl/grove

# pnpm
pnpm update -g @miniaxolotl/grove

# bun
bun update -g @miniaxolotl/grove
```

## Troubleshooting

### Server won't start

```bash
# Check logs
docker compose logs grove

# Verify Qdrant is reachable
curl http://localhost:6333/readyz
```

### MCP tool errors

```bash
# Verify collections exist
curl http://localhost:6333/collections
```

### Release PR not created

Ensure commits follow conventional commit format. Check release-please logs in the Actions tab.

## Security Checklist

- [ ] Set `QDRANT_API_KEY` if Qdrant requires authentication
- [ ] Enable TLS via reverse proxy
- [ ] Restrict access to port 26080 (allow only your IDE/agents)
- [ ] Use firewall rules to limit exposure
- [ ] Regularly update Docker images and dependencies

## Support

- Issues: https://github.com/miniaxolotl/grove/issues
- Docker Hub: https://hub.docker.com/r/miniaxolotl/grove
- GHCR: https://github.com/miniaxolotl/grove/pkgs/container/grove
