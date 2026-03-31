# qdrant-memory - Self-hosted agentic memory MCP server
#
# Build:
#   docker build -t qdrant-memory .
#
# Run (override env with -e):
#   docker run -e QDRANT_URL=http://host:6333 \
#              -e QDRANT_API_KEY=your-key \
#              qdrant-memory

# ── Build Stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

# Build dependencies for @huggingface/transformers ONNX runtime
RUN apk add --no-cache python3 make g++ python3-dev musl-dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production Stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

# Default HTTP port when TRANSPORT=http
EXPOSE 26080

WORKDIR /app

COPY --from=build --chown=nodeapp:nodejs /app/dist ./dist
COPY --from=build --chown=nodeapp:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodeapp:nodejs /app/package.json ./package.json

# Patch SDK: comment out the completions capability check.
# fastmcp registers a completion handler but doesn't announce the completions
# capability in its server info, causing SDK 1.29.0 to throw.
RUN sed -i '218s/^/\/\/ /' node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeapp -u 1001

USER nodeapp
ENTRYPOINT ["node", "dist/index.js"]
