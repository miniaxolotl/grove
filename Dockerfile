# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN apk add --no-cache python3 make g++ python3-dev musl-dev

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY lib/ ./lib/
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY scripts/setup/package.json ./scripts/setup/package.json
COPY scripts/deploy/package.json ./scripts/deploy/package.json
COPY scripts/release/package.json ./scripts/release/package.json
COPY tests/package.json ./tests/package.json

RUN pnpm install --frozen-lockfile

COPY packages/mcp/ ./packages/mcp/
COPY lib/typescript-config/ ./lib/typescript-config/
RUN pnpm --filter @qdrant-memory/mcp build
RUN pnpm --filter @qdrant-memory/mcp deploy --prod --legacy /prod

# Patch SDK: fastmcp doesn't announce completions capability
RUN find /prod/node_modules -path "*/@modelcontextprotocol/sdk/dist/esm/server/index.js" \
    -exec sed -i '218s/^/\/\/ /' {} + 2>/dev/null || true

# Trim ONNX runtime: keep only Linux x64 napi-v3
RUN find /prod/node_modules -path "*/onnxruntime-node/bin" -type d | while read bindir; do \
      find "$bindir" -mindepth 1 -maxdepth 1 -type d ! -name "napi-v3" -exec rm -rf {} + 2>/dev/null; \
      find "$bindir/napi-v3" -mindepth 1 -maxdepth 1 -type d ! -name "linux" -exec rm -rf {} + 2>/dev/null; \
      find "$bindir/napi-v3/linux" -mindepth 1 -maxdepth 1 -type d ! -name "x64" -exec rm -rf {} + 2>/dev/null; \
    done

# Remove web variants and GPU providers
RUN rm -rf /prod/node_modules/onnxruntime-web && \
    find /prod/node_modules -path "*/onnxruntime-web" -exec rm -rf {} + 2>/dev/null; \
    find /prod/node_modules -name "libonnxruntime_providers_cuda.so" -delete 2>/dev/null; \
    find /prod/node_modules -name "libonnxruntime_providers_tensorrt.so" -delete 2>/dev/null; \
    find /prod/node_modules -name "libonnxruntime_providers_core.so" ! -name "libonnxruntime_providers_core.so.1.*" -delete 2>/dev/null; \
    true

# Remove heavy unused deps
RUN rm -rf /prod/node_modules/@img /prod/node_modules/sharp /prod/node_modules/fsevents && \
    find /prod/node_modules -type d \( -name "__tests__" -o -name "test" -o -name "docs" -o -name "examples" \) \
      -exec rm -rf {} + 2>/dev/null; \
    find /prod/node_modules -type f \( -name "*.md" -o -name "*.map" -o -name "*.ts" -o -name "*.d.ts" \) \
      -delete 2>/dev/null; \
    find /prod/node_modules -name "LICENSE*" -delete 2>/dev/null; \
    true

# ── Production ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS production

LABEL org.opencontainers.image.source="https://github.com/miniaxolotl/qdrant-memory" \
      org.opencontainers.image.url="https://github.com/miniaxolotl/qdrant-memory" \
      org.opencontainers.image.documentation="https://github.com/miniaxolotl/qdrant-memory#readme" \
      org.opencontainers.image.title="qdrant-memory" \
      org.opencontainers.image.description="Self-hosted agentic memory MCP server using Qdrant" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Elias Mawa" \
      org.opencontainers.image.authors="Elias Mawa <elias@mawa.dev>" \
      org.opencontainers.image.base.name="node:22-alpine@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2f6960adef62ed3"

# Install runtime deps: curl for healthcheck, gcompat for ONNX
RUN apk add --no-cache curl gcompat

RUN addgroup -g 1001 -S nodejs && adduser -S nodeapp -u 1001
WORKDIR /app

COPY --from=build --chown=nodeapp:nodejs /prod/dist ./dist
COPY --from=build --chown=nodeapp:nodejs /prod/node_modules ./node_modules
COPY --from=build --chown=nodeapp:nodejs /prod/package.json ./package.json

USER nodeapp
EXPOSE 26080 26081

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:26081/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
