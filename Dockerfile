# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN apk add --no-cache python3 make g++ python3-dev musl-dev

WORKDIR /app

# Layer-cached install: manifests first, source later
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

# Flatten prod deps (resolves workspace: links)
RUN pnpm --filter @qdrant-memory/mcp deploy --prod --legacy /prod

# Patch SDK: fastmcp doesn't announce completions capability
RUN find /prod/node_modules -path "*/@modelcontextprotocol/sdk/dist/esm/server/index.js" \
    -exec sed -i '218s/^/\/\/ /' {} + 2>/dev/null || true

# Trim: onnxruntime ships ~670MB of multi-platform binaries
RUN find /prod/node_modules -path "*/onnxruntime-node/bin" -type d | while read bindir; do \
      find "$bindir" -mindepth 1 -maxdepth 1 -type d ! -name "napi-v3" -exec rm -rf {} +; \
      find "$bindir/napi-v3" -mindepth 1 -maxdepth 1 -type d ! -name "linux" -exec rm -rf {} +; \
      find "$bindir/napi-v3/linux" -mindepth 1 -maxdepth 1 -type d ! -name "x64" -exec rm -rf {} +; \
    done && \
    rm -rf /prod/node_modules/onnxruntime-web && \
    find /prod/node_modules -path "*/onnxruntime-web" -exec rm -rf {} + 2>/dev/null; \
    find /prod/node_modules -path "*/@img" -exec rm -rf {} + 2>/dev/null; \
    find /prod/node_modules -path "*/sharp" -exec rm -rf {} + 2>/dev/null; \
    find /prod/node_modules -type f \( \
      -name "*.md" -o -name "*.map" -o -name "*.ts" -o \
      -name "LICENSE*" -o -name "CHANGELOG*" \
    \) -delete 2>/dev/null; \
    find /prod/node_modules -type d \( -name "__tests__" -o -name "test" -o -name "docs" \) \
      -exec rm -rf {} + 2>/dev/null; \
    # Remove CUDA/TensorRT providers (~510MB) — Alpine is CPU-only \
    find /prod/node_modules -name "libonnxruntime_providers_cuda.so" -delete; \
    find /prod/node_modules -name "libonnxruntime_providers_tensorrt.so" -delete; \
    # Remove duplicate .so (keep versioned, symlink from unversioned) \
    find /prod/node_modules -name "libonnxruntime.so.1" -path "*/linux/x64/*" | while read f; do \
      dir=$(dirname "$f"); \
      versioned=$(find "$dir" -name "libonnxruntime.so.1.*" | head -1); \
      if [ -n "$versioned" ]; then rm "$f" && ln -s "$(basename "$versioned")" "$f"; fi; \
    done; \
    true

# ── Production ────────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache curl

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
