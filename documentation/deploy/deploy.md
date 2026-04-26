# Grove Deployment Guide

This guide covers deploying Grove MCP server in production.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (recommended) or Node.js 20+
- [Qdrant](https://qdrant.tech/documentation/quick-start/) instance (local or cloud)
- Optional: Reranking service (e.g., Cohere)

## Deployment Methods

### 1. Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env with your QDRANT_URL and other settings
docker compose up -d
```

This starts Grove on port 3100 with Qdrant.

**docker-compose.yml:**

```yaml
version: "3.8"
services:
  grove:
    image: ghcr.io/miniaxolotl/grove:latest
    ports:
      - "3100:3100"
    environment:
      - QDRANT_URL=http://qdrant:6333
      - EMBEDDING_MODEL=Xenocrat/embeddings
      - PORT=3100
    depends_on:
      - qdrant
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

volumes:
  qdrant_data:
```

### 2. Manual Build

```bash
# Clone and install dependencies
pnpm install

# Build for production
pnpm build

# Start the server
pnpm start
```

### 3. Systemd Service

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
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable grove
sudo systemctl start grove
```

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name grove.example.com;

    ssl_certificate /etc/letsencrypt/live/grove.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/grove.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
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
        proxy_pass http://127.0.0.1:3100/health;
        proxy_set_header Host $host;
    }
}
```

### Caddy

```caddy
grove.example.com {
    reverse_proxy localhost:3100
}
```

## Environment Variables

| Variable            | Description                 | Default                 |
| ------------------- | --------------------------- | ----------------------- |
| `QDRANT_URL`        | Qdrant server URL           | `http://localhost:6333` |
| `COLLECTION_PREFIX` | Prefix for collection names | `grove`                 |
| `EMBEDDING_MODEL`   | Embedding model             | `Xenocrat/embeddings`   |
| `RERANKING_URL`     | Reranking service URL       | (none)                  |
| `PORT`              | Server port                 | `3100`                  |
| `HOST`              | Server host                 | `0.0.0.0`               |

## Health Checks

```bash
# Check server health
curl http://localhost:3100/health

# Example response:
# {"status":"ok","tunnels":0,"uptime":12345}
```

## Initialization

After first start, collections are created automatically. To manually initialize:

```bash
pnpm run setup
```

This creates the required Qdrant collections. **Warning:** This deletes existing collections with the same prefix.

## OpenCode Plugin Deployment

```bash
# In your opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@miniaxolotl/grove-opencode-plugin"]
}
```

Configure via environment:

| Variable        | Description                       | Default                     |
| --------------- | --------------------------------- | --------------------------- |
| `GROVE_MCP_URL` | Grove MCP server URL              | `http://localhost:3100/mcp` |
| `GROVE_PROJECT` | Project name for memory filtering | (none)                      |

## Security Checklist

- [ ] Set `QDRANT_API_KEY` if Qdrant requires authentication
- [ ] Enable TLS via reverse proxy (Let's Encrypt recommended)
- [ ] Restrict access to port 3100 (allow only your IDE/agents)
- [ ] Use firewall rules to limit exposure
- [ ] Regularly update Docker images and dependencies

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

# Check collections have points
curl http://localhost:6333/collections/grove_memories Points/0
```

### Performance issues

- Increase Qdrant resources (memory, CPU)
- Enable reranking for better search quality
- Consider adding a caching layer

## Updating

```bash
# Pull latest image
docker pull ghcr.io/miniaxolotl/grove:latest

# Restart containers
docker compose down
docker compose up -d
```

## Support

- Issues: https://github.com/miniaxolotl/grove/issues
- Docker Hub: https://hub.docker.com/r/miniaxolotl/grove
- GHCR: https://github.com/miniaxolotl/grove/pkgs/container/grove
