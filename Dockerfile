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
ARG GROVE_HELD_RELEASE_BUILD
ARG GROVE_POSTHOG_KEY
ARG GROVE_CLI_SENTRY_DSN
ARG GROVE_API_SENTRY_DSN
RUN node scripts/build.mjs api
RUN pnpm --filter @miniaxolotl/grove-server deploy --prod --legacy /prod

FROM node:24-bookworm-slim AS api
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

FROM build AS mcp-build
RUN node scripts/build.mjs mcp

FROM node:24-bookworm-slim AS mcp
LABEL org.opencontainers.image.source="https://github.com/miniaxolotl/grove" \
      org.opencontainers.image.title="grove-mcp" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=mcp-build --chown=node:node /app/packages/mcp/dist ./dist
COPY --from=mcp-build --chown=node:node /app/packages/mcp/package.json ./package.json
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["mcp", "--stdio"]

FROM build AS website-build
# Only public configuration is baked into the browser bundle. Runtime provider
# credentials never enter Docker's context, build arguments, layers or attestations.
ARG SITE_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_POSTHOG_ENABLED
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_SENTRY_ENABLED
ARG NEXT_PUBLIC_SENTRY_DSN
ENV GROVE_CONTAINER_BUILD=1 NEXT_TELEMETRY_DISABLED=1 VERCEL_ENV=production
RUN node -e "require('node:fs').writeFileSync('packages/website/public/release.json', JSON.stringify({repository:'miniaxolotl/grove',version:require('./package.json').version,sourceSha:process.env.RELEASE_SOURCE_SHA || 'development'}))"
RUN pnpm build:website

FROM node:24-bookworm-slim AS website
LABEL org.opencontainers.image.source="https://github.com/miniaxolotl/grove" \
      org.opencontainers.image.title="grove-website" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=website-build --chown=node:node /app/packages/website/.next/standalone ./
COPY --from=website-build --chown=node:node /app/packages/website/.next/static /app/packages/website/.next/static
COPY --from=website-build --chown=node:node /app/packages/website/public /app/packages/website/public
USER node
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/release.json').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "packages/website/server.js"]

# Keep docker build / existing Compose consumers on the original API runtime.
FROM api AS production
