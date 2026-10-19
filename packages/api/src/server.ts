import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { probeDatabase } from "@lib/database";
import { createApp } from "./app.ts";
import { Authentication, clerkVerifier } from "./auth.ts";
import { createRuntime } from "./runtime.ts";

export async function startServer() {
  const runtime = await createRuntime();
  const { env, db, memories } = runtime;
  const app = createApp({
    memories,
    models: runtime.models,
    auth: new Authentication(db, clerkVerifier(env)),
    origin: env.API_ORIGIN,
    siteUrl: env.SITE_URL,
    issuer: env.CLERK_ISSUER,
    webhookSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
    ready: () => probeDatabase(db),
  });
  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
    hostname: "0.0.0.0",
  }) as Server;
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  console.error(JSON.stringify({ status: "listening", port: env.PORT }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    await runtime.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  return { server, close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startServer();
}
