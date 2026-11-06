FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
# Dependency manifests first so the install layer survives source changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/ai/package.json lib/ai/
COPY lib/config/package.json lib/config/
COPY lib/database/package.json lib/database/
COPY lib/environment/package.json lib/environment/
COPY lib/eslint-config/package.json lib/eslint-config/
COPY lib/integration-core/package.json lib/integration-core/
COPY lib/memory/package.json lib/memory/
COPY lib/shared/package.json lib/shared/
COPY lib/telemetry/package.json lib/telemetry/
COPY lib/typescript-config/package.json lib/typescript-config/
COPY packages/api/package.json packages/api/
COPY packages/browser-extension/package.json packages/browser-extension/
COPY packages/grove-claude-plugin/package.json packages/grove-claude-plugin/
COPY packages/grove-codex-plugin/package.json packages/grove-codex-plugin/
COPY packages/grove-opencode-plugin/package.json packages/grove-opencode-plugin/
COPY packages/mcp/package.json packages/mcp/
COPY packages/website/package.json packages/website/
COPY scripts/deploy/package.json scripts/deploy/
COPY scripts/migrate-legacy/package.json scripts/migrate-legacy/
COPY scripts/setup/package.json scripts/setup/
COPY tests/package.json tests/
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN pnpm install --frozen-lockfile
COPY . .
ARG GROVE_TELEMETRY_BUILD
ARG RELEASE_SOURCE_SHA
ARG GROVE_POSTHOG_KEY
ARG GROVE_CLI_SENTRY_DSN
ARG GROVE_API_SENTRY_DSN
RUN node scripts/build.mjs api
RUN pnpm --filter @miniaxolotl/grove-server deploy --prod --legacy /prod

FROM node:24-bookworm-slim AS production
LABEL org.opencontainers.image.source="https://github.com/miniaxolotl/grove" \
      org.opencontainers.image.title="Grove private memory API" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=build --chown=node:node /prod /app
RUN mkdir -p /app/data/models /app/data/exports /app/data/media && chmod 700 /app/data/media && chown -R node:node /app/data
USER node
ENV NODE_ENV=production PORT=26080 EMBEDDING_CACHE=/app/data/models
EXPOSE 26080
HEALTHCHECK --interval=20s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '26080') + '/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
