FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY . .
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN pnpm install --frozen-lockfile
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
