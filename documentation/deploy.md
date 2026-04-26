# Deploy & Release Guide

## Releases

Grove uses [release-please](https://github.com/googleapis/release-please) for automated versioning and releases.

### Workflow

1. Push conventional commits to `production`
2. Release-please creates a release PR with version bumps and changelogs
3. Merge the PR → GitHub releases, tags, and npm publishes

### Conventional Commits

| Prefix | Effect |
| ------ | ------ |
| `feat:` | Minor version bump |
| `fix:` | Patch version bump |
| `BREAKING CHANGE:` | Major version bump |
| `docs:`, `refactor:`, `chore:` | No version bump |

### Config Files

- `release-please-config.json` — package definitions
- `.release-please-manifest.json` — current versions

## Deploy

### Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

### Docker Run

```bash
# GHCR
docker run -p 26080:26080 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  ghcr.io/miniaxolotl/grove:latest

# Docker Hub
docker run -p 26080:26080 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  miniaxolotl/grove:latest
```

### Systemd

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

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now grove
```

### Reverse Proxy

**Nginx:**

```nginx
server {
    listen 443 ssl;
    server_name grove.example.com;

    location / {
        proxy_pass http://127.0.0.1:26080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

**Caddy:**

```caddy
grove.example.com {
    reverse_proxy localhost:26080
}
```

## CI/CD

| Workflow | Trigger | Action |
| -------- | ------- | ------ |
| `ci.yml` | Push/PR to `production`, `development` | Lint, build, test |
| `release.yml` | Push to `production` | Release PR → npm publish |
| `deploy.yml` | `grove-v*` tag | Push Docker to GHCR + Docker Hub |

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

```bash
# Check logs
docker compose logs grove

# Verify Qdrant
curl http://localhost:6333/readyz

# Verify collections
curl http://localhost:6333/collections

# Health check
curl http://localhost:26081/health
```

## Security

- [ ] Set `QDRANT_API_KEY` if Qdrant requires auth
- [ ] Enable TLS via reverse proxy
- [ ] Restrict port 26080 access
- [ ] Keep images and dependencies updated
