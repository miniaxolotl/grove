FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# Build dependencies for @huggingface/transformers ONNX runtime
RUN apk add --no-cache python3 make g++ python3-dev musl-dev

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/ ./lib/
COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY tests/ ./tests/
RUN pnpm install --frozen-lockfile

RUN pnpm --filter @qdrant-memory/server build

FROM node:22-alpine AS production

EXPOSE 26080 26081

WORKDIR /app

COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/lib ./lib
COPY --from=build /app/packages/server/package.json ./packages/server/package.json

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
RUN CI=true pnpm install --frozen-lockfile --prod

# Patch SDK: comment out the completions capability check.
# fastmcp registers a completion handler but doesn't announce the completions
# capability in its server info, causing SDK 1.29.0 to throw.
RUN find node_modules -path "*/@modelcontextprotocol/sdk/dist/esm/server/index.js" -exec sed -i '218s/^/\/\/ /' {} +

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeapp -u 1001

USER nodeapp

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD sh -c 'cat < /dev/tcp/localhost/26081 || exit 1'

ENTRYPOINT ["node", "dist/index.js"]
