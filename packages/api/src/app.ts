import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamText } from "hono/streaming";
import { z, ZodError } from "zod";
import { Webhook } from "svix";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMemoryMcp, type ToolName } from "@lib/integration-core/mcp";
import {
  GroveError,
  oauthScopes,
  rememberSchema,
  recallSchema,
  listSchema,
  versionSchema,
  forgetSchema,
  projectSchema,
  grantSchema,
  connectionSchema,
  uuidSchema,
  type Principal,
} from "@lib/shared/contracts";
import type { MemoryService } from "@lib/memory";
import type { Authentication } from "./auth.ts";

export type AppDependencies = {
  memories: MemoryService;
  auth: Pick<Authentication, "principal">;
  origin: string;
  siteUrl: string;
  issuer: string;
  webhookSecret: string;
  ready: () => Promise<void>;
};
type Environment = { Variables: { principal: Principal; requestId: string } };

export function createApp(deps: AppDependencies) {
  const app = new Hono<Environment>();
  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    c.header("X-Request-ID", c.get("requestId"));
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 128 * 1024,
      onError: () => {
        throw new GroveError("too_large", "Request body is too large", 413);
      },
    }),
  );
  app.use(
    "*",
    cors({
      origin: deps.siteUrl,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "MCP-Protocol-Version",
      ],
      exposeHeaders: ["WWW-Authenticate", "X-Request-ID"],
    }),
  );
  app.onError((error, c) => {
    const detail =
      error instanceof GroveError
        ? error
        : error instanceof ZodError || error instanceof SyntaxError
          ? new GroveError("invalid_request", "Check the request fields", 400)
          : new GroveError(
              "unavailable",
              "Grove is temporarily unavailable",
              503,
            );
    if (detail.status === 401)
      c.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${deps.origin}/.well-known/oauth-protected-resource/mcp"`,
      );
    if (detail.status === 429) c.header("Retry-After", "60");
    // Content-free diagnostics only. Driver/provider exceptions may contain SQL, parameters or credentials.
    if (detail.status >= 500)
      console.error(
        JSON.stringify({ requestId: c.get("requestId"), code: detail.code }),
      );
    return c.json(
      {
        success: false,
        error: {
          code: detail.code,
          message: detail.message,
          requestId: c.get("requestId"),
        },
      },
      detail.status as 400,
    );
  });
  app.notFound((c) =>
    c.json(
      {
        success: false,
        error: { code: "not_found", message: "Route not found" },
      },
      404,
    ),
  );
  const metadata = {
    resource: `${deps.origin}/mcp`,
    authorization_servers: [deps.issuer],
    scopes_supported: oauthScopes,
    bearer_methods_supported: ["header"],
  };
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(metadata));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(metadata));
  app.get("/health/live", (c) => c.json({ status: "ok" }));
  app.get("/health/ready", async (c) => {
    await deps.ready();
    return c.json({
      status: "ready",
      semantic: deps.memories.embedder ? "enabled" : "disabled",
    });
  });
  app.post("/v1/webhooks/clerk", async (c) => {
    let event: unknown;
    try {
      event = new Webhook(deps.webhookSecret).verify(await c.req.text(), {
        "svix-id": c.req.header("svix-id") ?? "",
        "svix-timestamp": c.req.header("svix-timestamp") ?? "",
        "svix-signature": c.req.header("svix-signature") ?? "",
      });
    } catch {
      throw new GroveError(
        "invalid_signature",
        "Invalid webhook signature",
        400,
      );
    }
    const payload = z
      .object({
        type: z.string(),
        timestamp: z.number().int(),
        data: z.object({
          id: z.string().min(1),
          banned: z.boolean().optional(),
          locked: z.boolean().optional(),
        }),
      })
      .parse(event);
    await deps.memories.db.transaction(async (trx) => {
      await trx.raw("SELECT grove_webhook(?, ?, ?, ?)", [
        c.req.header("svix-id")!,
        payload.type,
        payload.data.id,
        payload.timestamp,
      ]);
      if (payload.type === "user.created" || payload.type === "user.updated") {
        await trx.raw("SELECT grove_user_state(?, ?, ?)", [
          payload.data.id,
          payload.timestamp,
          !!(payload.data.banned || payload.data.locked),
        ]);
      }
    });
    return c.json({ success: true });
  });
  const authorize = async (
    c: import("hono").Context<Environment>,
    next: () => Promise<void>,
  ) => {
    const origin = c.req.header("origin");
    if (origin && origin !== deps.siteUrl && origin !== deps.origin)
      throw new GroveError("forbidden", "Origin is not allowed", 403);
    c.set("principal", await deps.auth.principal(c.req.raw));
    await next();
  };
  app.use("/v1/*", async (c, next) => {
    if (c.req.path === "/v1/webhooks/clerk") return next();
    return authorize(c, next);
  });
  app.use("/mcp", authorize);
  const service = deps.memories;
  const body = async <T>(
    c: import("hono").Context<Environment>,
    schema: z.ZodType<T>,
  ) => schema.parse(await c.req.json());
  const mutation = async <T>(
    c: import("hono").Context<Environment>,
    schema: z.ZodType<T>,
  ) => {
    const value = await c.req.json();
    const key = c.req.header("idempotency-key");
    if (key && value.operationId && value.operationId !== key)
      throw new GroveError(
        "invalid_request",
        "Conflicting operation identifiers",
      );
    return schema.parse({ ...value, ...(key ? { operationId: key } : {}) });
  };
  app.get("/v1/me", async (c) =>
    c.json({ success: true, data: await service.me(c.get("principal")) }),
  );
  app.get("/v1/projects", async (c) =>
    c.json({ success: true, data: await service.projects(c.get("principal")) }),
  );
  app.post("/v1/projects", async (c) =>
    c.json({
      success: true,
      data: await service.project(
        c.get("principal"),
        await body(c, projectSchema),
      ),
    }),
  );
  app.patch("/v1/projects/:id", async (c) =>
    c.json({
      success: true,
      data: await service.project(
        c.get("principal"),
        await body(c, projectSchema),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.post("/v1/memories", async (c) =>
    c.json({
      success: true,
      data: await service.remember(
        c.get("principal"),
        await mutation(c, rememberSchema),
      ),
    }),
  );
  app.patch("/v1/memories/:id", async (c) => {
    const input = await mutation(c, rememberSchema);
    if (input.id !== uuidSchema.parse(c.req.param("id")))
      throw new GroveError("invalid_request", "Memory ID mismatch");
    return c.json({
      success: true,
      data: await service.remember(c.get("principal"), input),
    });
  });
  app.get("/v1/memories", async (c) =>
    c.json({
      success: true,
      data: await service.list(
        c.get("principal"),
        listSchema.parse({
          ...c.req.query(),
          limit: c.req.query("limit")
            ? Number(c.req.query("limit"))
            : undefined,
        }),
      ),
    }),
  );
  // Library/archive search is separate from active-only agent recall. Query text never enters access-log URLs.
  app.post("/v1/memories/search", async (c) =>
    c.json({
      success: true,
      data: await service.list(c.get("principal"), await body(c, listSchema)),
    }),
  );
  app.get("/v1/memories/:id", async (c) =>
    c.json({
      success: true,
      data: await service.get(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.get("/v1/memories/:id/revisions", async (c) =>
    c.json({
      success: true,
      data: await service.revisions(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  for (const action of ["archive", "restore"] as const)
    app.post(`/v1/memories/:id/${action}`, async (c) =>
      c.json({
        success: true,
        data: await service.lifecycle(
          c.get("principal"),
          uuidSchema.parse(c.req.param("id")),
          action,
          await mutation(c, versionSchema),
        ),
      }),
    );
  app.post("/v1/memories/delete", async (c) =>
    c.json({
      success: true,
      data: await service.forget(
        c.get("principal"),
        await mutation(c, forgetSchema),
      ),
    }),
  );
  app.post("/v1/recall", async (c) =>
    c.json({
      success: true,
      data: await service.recall(
        c.get("principal"),
        await body(c, recallSchema),
      ),
    }),
  );
  app.get("/v1/connections", async (c) =>
    c.json({
      success: true,
      data: await service.connections(c.get("principal")),
    }),
  );
  app.post("/v1/connections", async (c) => {
    const { clientId, ...grant } = await body(c, connectionSchema);
    return c.json({
      success: true,
      data: await service.grant(c.get("principal"), grant, { clientId }),
    });
  });
  app.patch("/v1/connections/:id", async (c) =>
    c.json({
      success: true,
      data: await service.grant(
        c.get("principal"),
        await body(c, grantSchema),
        { id: uuidSchema.parse(c.req.param("id")) },
      ),
    }),
  );
  app.delete("/v1/connections/:id", async (c) =>
    c.json({
      success: true,
      data: await service.revoke(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.post("/v1/logout", async (c) =>
    c.json({
      success: true,
      data: await service.revokeSelf(c.get("principal")),
    }),
  );
  app.post("/v1/keys", async (c) =>
    c.json(
      {
        success: true,
        data: await service.grant(
          c.get("principal"),
          await body(c, grantSchema),
          { key: true },
        ),
      },
      201,
    ),
  );
  app.patch("/v1/account/settings", async (c) =>
    c.json({
      success: true,
      data: await service.settings(
        c.get("principal"),
        await body(
          c,
          z
            .object({ captureEnabled: z.boolean(), recallEnabled: z.boolean() })
            .strict(),
        ),
      ),
    }),
  );
  app.post("/v1/account/delete", async (c) => {
    await body(
      c,
      z.object({ confirm: z.literal("delete my account") }).strict(),
    );
    return c.json(
      { success: true, data: await service.deleteAccount(c.get("principal")) },
      202,
    );
  });
  app.get("/v1/account/export", async (c) => {
    const principal = c.get("principal");
    // Authorize before committing download headers, then reauthorize each page.
    const first = await service.exportPage(principal);
    c.header(
      "Content-Disposition",
      'attachment; filename="grove-memories.ndjson"',
    );
    return streamText(c, async (stream) => {
      let page = first;
      while (page.length && !stream.aborted) {
        for (const memory of page) await stream.writeln(JSON.stringify(memory));
        if (page.length < 50) break;
        page = await service.exportPage(principal, page.at(-1)!.id);
      }
    });
  });
  app.all("/mcp", async (c) => {
    const principal = c.get("principal");
    await service.me(principal);
    const execute = async (tool: ToolName, value: unknown) => {
      if (tool === "remember")
        return service.remember(principal, rememberSchema.parse(value));
      if (tool === "recall")
        return service.recall(principal, recallSchema.parse(value));
      if (tool === "memories")
        return service.list(principal, listSchema.parse(value));
      return service.forget(principal, forgetSchema.parse(value));
    };
    const server = createMemoryMcp(execute);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 128 * 1024,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      await server.close();
    }
  });
  return app;
}
