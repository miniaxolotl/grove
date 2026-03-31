FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# Build dependencies for @huggingface/transformers ONNX runtime
RUN apk add --no-cache python3 make g++ python3-dev musl-dev

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/ ./lib/
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

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
