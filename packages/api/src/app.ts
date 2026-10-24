import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { accountIdentity, type Reporter } from "@lib/telemetry";
import {
  requestCollectionAllowed,
  withTelemetry,
} from "@lib/telemetry/context";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";
import { notebookLifecycleSchema } from "@lib/shared/notebook-lifecycle";
import { conversationHistorySchema } from "@lib/shared/conversation-history";
import { searchConversationHistory } from "@lib/memory";
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
  connectSchema,
  approveConnectSchema,
  uuidSchema,
  type Principal,
} from "@lib/shared/contracts";
import {
  ConnectionSetup,
  Sharing,
  MediaAttachments,
  mediaDescriptor,
  Tasks,
  SpeechJobs,
  type ArtifactStore,
  withMemoryOperation,
  executeMemoryTool,
  type MemoryService,
} from "@lib/memory";
import { exportRequestSchema, importRequestSchema } from "@lib/shared/jobs";
import { databaseSignal, withDatabaseSignal } from "@lib/database";
import {
  Admission,
  admittedRequest,
  defaultCapacity,
  type ApiCapacity,
} from "./admission.ts";
import {
  publicShareQuerySchema,
  shareEnableSchema,
  shareMutationSchema,
  shareScopeSchema,
} from "@lib/shared/sharing";
import type { Authentication } from "./auth.ts";
import type { MediaStore } from "./media-store.ts";
import { verifyImage } from "./media-images.ts";
import { verifyAudio } from "./media-audio.ts";
import { noteArchive } from "./media-archive.ts";
import { imageLimits, mediaMimeTypes } from "@lib/shared/media";
import {
  askSchema,
  briefRequestSchema,
  modelUpdateSchema,
} from "@lib/shared/models";
import type { ModelRegistry } from "./models.ts";
import { InferenceError, type SpeechProviders } from "@lib/ai";
import { speechRequestSchema } from "@lib/shared/speech";
import { settingsUpdateSchema } from "@lib/shared/settings";
import {
  assistanceRequestSchema,
  assistanceApplySchema,
  assistanceReviewSchema,
  notebookVisitSchema,
} from "@lib/shared/assistance";
import {
  connectionQuerySchema,
  connectionReviewSchema,
  connectionLevelSchema,
} from "@lib/shared/relationships";
import {
  conversationCreateSchema,
  conversationTurnSchema,
  toolSettingsSchema,
  askToolsSchema,
  defaultAskTools,
} from "@lib/shared/conversations";

export type AppDependencies = {
  media?: MediaStore | null;
  artifacts?: ArtifactStore | null;
  speech?: SpeechProviders;
  memories: MemoryService;
  models?: ModelRegistry;
  auth: Pick<Authentication, "principal">;
  origin: string;
  siteUrl: string;
  issuer: string;
  webhookSecret: string;
  ready: () => Promise<void>;
  telemetry?: Pick<Reporter, "forIdentity" | "operation">;
  shareLinkKey?: string;
  capacity?: Partial<ApiCapacity>;
};
type Environment = {
  Variables: {
    principal: Principal;
    requestId: string;
    signal: AbortSignal;
    finish: () => void;
    streaming: boolean;
  };
};

export function createApp(deps: AppDependencies) {
  const app = new Hono<Environment>();
  const speech = new SpeechJobs(
    deps.memories,
    deps.speech ?? {},
    deps.artifacts,
  );
  const capacity = { ...defaultCapacity, ...deps.capacity };
  const foreground = new Admission(
    capacity.concurrency,
    capacity.queued,
    capacity.queueTimeoutMs,
  );
  const interactive = new Admission(
    capacity.interactiveConcurrency,
    capacity.interactiveConcurrency,
    capacity.queueTimeoutMs,
  );
  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    c.header("X-Request-ID", c.get("requestId"));
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.path.startsWith("/public/shares/"))
      c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    const started = performance.now();
    await next();
    if (
      requestCollectionAllowed(c.req.raw.headers) &&
      !c.req.path.startsWith("/health/")
    )
      deps.telemetry?.operation(
        "http_request",
        started,
        c.res.status >= 500
          ? "error"
          : c.res.status >= 400
            ? "unavailable"
            : "success",
        undefined,
        c.error,
      );
  });
  app.use(
    "*",
    cors({
      origin: deps.siteUrl,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "MCP-Protocol-Version",
        "X-Grove-Telemetry",
        "X-Grove-Note-Version",
        "X-Grove-Content-Sha256",
        "Range",
      ],
      exposeHeaders: ["WWW-Authenticate", "X-Request-ID", "Retry-After"],
    }),
  );
  app.onError((error, c) => {
    const detail =
      error instanceof GroveError
        ? error
        : error instanceof InferenceError
          ? new GroveError(
              error.code,
              `Model request failed (${error.code})`,
              503,
            )
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
    if (detail.status === 503) c.header("Retry-After", "1");
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
  app.use("*", async (c, next) => {
    if (
      c.req.path.startsWith("/health/") ||
      c.req.path.startsWith("/.well-known/")
    )
      return next();
    const mediaUpload =
      c.req.method === "PUT" &&
      /^\/v1\/memories\/[0-9a-f-]+\/media\/[0-9a-f-]+$/.test(c.req.path);
    const long =
      mediaUpload ||
      /\/archive-file$/.test(c.req.path) ||
      /\/media\/[0-9a-f-]+$/.test(c.req.path) ||
      /^\/v1\/speech\/[0-9a-f-]+\/audio$/.test(c.req.path) ||
      c.req.path === "/v1/ask" ||
      c.req.path === "/v1/models/test" ||
      /^\/v1\/tasks\/[^/]+\/download$/.test(c.req.path) ||
      /^\/v1\/conversations\/[^/]+\/turns$/.test(c.req.path);
    const deadline = new AbortController();
    const signal = AbortSignal.any([c.req.raw.signal, deadline.signal]);
    const timer = setTimeout(
      () =>
        deadline.abort(
          new GroveError(
            "request_timeout",
            "This request took too long. Try again.",
            503,
          ),
        ),
      long ? capacity.interactiveTimeoutMs : capacity.requestTimeoutMs,
    );
    timer.unref();
    let release: (() => void) | undefined;
    const finish = () => {
      clearTimeout(timer);
      release?.();
    };
    c.set("signal", signal);
    c.set("finish", finish);
    try {
      release = await (long ? interactive : foreground).acquire(signal);
      await withMemoryOperation(async () => {
        if (!mediaUpload) c.req.raw = await admittedRequest(c.req.raw, signal);
        await next();
        if (!c.get("streaming") && !c.error) signal.throwIfAborted();
      }, signal);
    } finally {
      if (!c.req.raw.bodyUsed) void c.req.raw.body?.cancel().catch(() => {});
      if (!c.get("streaming")) finish();
    }
  });
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
    c.get("signal").throwIfAborted();
    await deps.models?.refresh();
    const sink = deps.telemetry?.forIdentity(
      accountIdentity(c.get("principal").accountId),
      requestCollectionAllowed(c.req.raw.headers),
    );
    if (sink) await withTelemetry(sink, next);
    else await next();
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
  const sharing = new Sharing(service, {
    key: deps.shareLinkKey,
    siteUrl: deps.siteUrl,
  });
  const attachments = new MediaAttachments(service);
  app.post("/v1/tools/:tool", async (c) =>
    c.json({
      success: true,
      data: await executeMemoryTool(
        service,
        c.get("principal"),
        c.req.param("tool"),
        await mutation(c, z.record(z.string(), z.unknown())),
        c.get("signal"),
      ),
    }),
  );
  app.get("/v1/memories/:id/archive-file", async (c) => {
    if (!deps.media)
      throw new GroveError(
        "media_unavailable",
        "Media storage is not configured",
        503,
      );
    const id = uuidSchema.parse(c.req.param("id")),
      version = c.req.query("version")
        ? z.coerce.number().int().positive().parse(c.req.query("version"))
        : undefined;
    const cancelled = new AbortController(),
      signal = AbortSignal.any([c.get("signal"), cancelled.signal]);
    const source = await noteArchive(
        service,
        deps.media,
        c.get("principal"),
        id,
        version,
        signal,
      ),
      stream = new PassThrough();
    stream.once("close", () => {
      if (!stream.readableEnded) cancelled.abort();
    });
    c.set("streaming", true);
    void pipeline(source, stream, { signal })
      .catch(() => {})
      .finally(c.get("finish"));
    c.header("Content-Type", "application/x-tar");
    c.header(
      "Content-Disposition",
      `attachment; filename="grove-note-${id}.tar"`,
    );
    return c.body(Readable.toWeb(stream) as ReadableStream);
  });
  app.put("/v1/memories/:memoryId/media/:id", async (c) => {
    if (!deps.media)
      throw new GroveError(
        "media_unavailable",
        "Media storage is not configured",
        503,
      );
    const principal = c.get("principal");
    const input = {
      id: uuidSchema.parse(c.req.param("id")),
      memoryId: uuidSchema.parse(c.req.param("memoryId")),
      version: z.coerce
        .number()
        .int()
        .positive()
        .parse(c.req.header("x-grove-note-version")),
      bytes: z.coerce
        .number()
        .int()
        .min(1)
        .max(imageLimits.bytes)
        .parse(c.req.header("content-length")),
      mime: z.enum(mediaMimeTypes).parse(c.req.header("content-type")),
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .parse(c.req.header("x-grove-content-sha256")),
    };
    const claim = await attachments.claim(principal, input);
    if (claim.replay)
      return c.json({ success: true, data: mediaDescriptor(claim.row) });
    try {
      if (!c.req.raw.body)
        throw new GroveError("invalid_image", "Image body required", 400);
      const source = Readable.fromWeb(
        c.req.raw.body as import("node:stream/web").ReadableStream,
      );
      const verified =
        input.mime === "audio/wav"
          ? await verifyAudio(source, c.get("signal"))
          : await verifyImage(source, input.mime, c.get("signal"));
      if (
        verified.bytes.length !== input.bytes ||
        verified.sha256 !== input.sha256
      )
        throw new GroveError(
          "invalid_image",
          "Image length or checksum does not match",
          400,
        );
      await deps.media.write(claim.row.objectKey, verified, c.get("signal"));
      return c.json(
        {
          success: true,
          data: await attachments.finish(
            principal,
            input,
            claim.row.leaseId,
            verified,
          ),
        },
        201,
      );
    } catch (error) {
      await attachments
        .fail(principal, input.id, claim.row.leaseId)
        .catch(() => {});
      throw error;
    }
  });
  const mediaResponse = async (
    c: import("hono").Context<Environment>,
    authorizeMedia: () => Promise<{
      key: string;
      mime: string;
      bytes: number;
      sha256: string;
    }>,
    storage:
      | { read(key: string, signal: AbortSignal): Promise<Readable> }
      | null
      | undefined = deps.media,
  ) => {
    if (!storage)
      throw new GroveError(
        "media_unavailable",
        "Media storage is not configured",
        503,
      );
    const object = await authorizeMedia();
    let start = 0,
      end = object.bytes - 1;
    const range = c.req.header("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        c.header("Content-Range", `bytes */${object.bytes}`);
        return c.body(null, 416);
      }
      if (!match[1]) start = Math.max(0, object.bytes - Number(match[2]));
      else {
        start = Number(match[1]);
        end = match[2] ? Math.min(end, Number(match[2])) : end;
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= object.bytes
      ) {
        c.header("Content-Range", `bytes */${object.bytes}`);
        return c.body(null, 416);
      }
      c.header("Content-Range", `bytes ${start}-${end}/${object.bytes}`);
    }
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Type", object.mime);
    c.header("Content-Length", String(end - start + 1));
    c.header("Content-Disposition", "inline");
    if (c.req.method === "HEAD") return c.body(null, range ? 206 : 200);
    const cancelled = new AbortController(),
      signal = AbortSignal.any([c.get("signal"), cancelled.signal]);
    const source = await storage.read(object.key, signal),
      stream = new PassThrough();
    stream.once("close", () => {
      if (!stream.readableEnded) cancelled.abort();
    });
    c.set("streaming", true);
    void pipeline(
      source,
      async function* (chunks) {
        let checked = Date.now(),
          offset = 0;
        for await (const chunk of chunks) {
          if (Date.now() - checked >= 1000) {
            const fresh = await withDatabaseSignal(signal, authorizeMedia);
            if (fresh.key !== object.key) throw new Error("media_changed");
            checked = Date.now();
          }
          const next = offset + chunk.length;
          if (next > start && offset <= end)
            yield chunk.subarray(
              Math.max(0, start - offset),
              Math.min(chunk.length, end - offset + 1),
            );
          offset = next;
          if (offset > end) break;
        }
      },
      stream,
      { signal },
    )
      .catch(() => {})
      .finally(c.get("finish"));
    return c.body(Readable.toWeb(stream) as ReadableStream, range ? 206 : 200);
  };
  app.get("/v1/memories/:memoryId/media/:id", async (c) => {
    const memoryId = uuidSchema.parse(c.req.param("memoryId")),
      id = uuidSchema.parse(c.req.param("id"));
    const version = c.req.query("version")
      ? z.coerce.number().int().positive().parse(c.req.query("version"))
      : undefined;
    return mediaResponse(c, () =>
      attachments.read(c.get("principal"), memoryId, id, version),
    );
  });
  app.post("/v1/memories/:memoryId/speech", async (c) =>
    c.json(
      {
        success: true,
        data: await speech.enqueue(
          c.get("principal"),
          uuidSchema.parse(c.req.param("memoryId")),
          await mutation(c, speechRequestSchema),
        ),
      },
      202,
    ),
  );
  app.get("/v1/speech/:id", async (c) =>
    c.json({
      success: true,
      data: await speech.get(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.post("/v1/speech/:id/cancel", async (c) => {
    await mutation(c, z.object({}).strict());
    return c.json({
      success: true,
      data: await speech.cancel(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    });
  });
  app.get("/v1/speech/:id/audio", async (c) => {
    const id = uuidSchema.parse(c.req.param("id"));
    return mediaResponse(
      c,
      () => speech.audio(c.get("principal"), id),
      deps.artifacts,
    );
  });
  app.get("/v1/memories/:memoryId/media/:id/transcript", async (c) =>
    c.json({
      success: true,
      data: await attachments.transcript(
        c.get("principal"),
        uuidSchema.parse(c.req.param("memoryId")),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.patch("/v1/memories/:memoryId/media/:id/transcript", async (c) =>
    c.json({
      success: true,
      data: await attachments.saveTranscript(
        c.get("principal"),
        uuidSchema.parse(c.req.param("memoryId")),
        uuidSchema.parse(c.req.param("id")),
        await body(
          c,
          z
            .object({
              operationId: z.uuid(),
              expectedVersion: z.number().int().min(0),
              text: z.string().max(6000),
            })
            .strict(),
        ),
      ),
    }),
  );
  app.get("/public/shares/:token/notes/:memoryId/media/:id", async (c) => {
    if (!deps.shareLinkKey)
      throw new GroveError("not_found", "Media is unavailable", 404);
    const memoryId = uuidSchema.parse(c.req.param("memoryId")),
      id = uuidSchema.parse(c.req.param("id"));
    return mediaResponse(c, () =>
      attachments.publicRead(c.req.param("token"), memoryId, id),
    );
  });
  for (const [resource, kind] of [
    ["memories", "note"],
    ["projects", "notebook"],
  ] as const) {
    app.get(`/v1/${resource}/:id/share`, async (c) =>
      c.json({
        success: true,
        data: await sharing.get(c.get("principal"), {
          kind,
          id: uuidSchema.parse(c.req.param("id")),
        }),
      }),
    );
    app.post(`/v1/${resource}/:id/share`, async (c) =>
      c.json({
        success: true,
        data: await sharing.enable(
          c.get("principal"),
          { kind, id: uuidSchema.parse(c.req.param("id")) },
          await mutation(c, shareEnableSchema),
        ),
      }),
    );
  }
  app.patch("/v1/shares/:id", async (c) =>
    c.json({
      success: true,
      data: await sharing.change(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        "scope",
        await mutation(c, shareScopeSchema),
      ),
    }),
  );
  app.post("/v1/shares/:id/rotate", async (c) =>
    c.json({
      success: true,
      data: await sharing.change(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        "rotate",
        await mutation(c, shareMutationSchema),
      ),
    }),
  );
  app.delete("/v1/shares/:id", async (c) =>
    c.json({
      success: true,
      data: await sharing.change(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        "revoke",
        await mutation(c, shareMutationSchema),
      ),
    }),
  );
  app.get("/public/shares/:token", async (c) =>
    c.json({
      success: true,
      data: await sharing.read(
        c.req.param("token"),
        "root",
        undefined,
        publicShareQuerySchema.parse(c.req.query()),
      ),
    }),
  );
  for (const [resource, kind] of [
    ["notes", "note"],
    ["notebooks", "notebook"],
  ] as const) {
    app.get(`/public/shares/:token/${resource}/:id`, async (c) =>
      c.json({
        success: true,
        data: await sharing.read(
          c.req.param("token"),
          kind,
          c.req.param("id"),
          publicShareQuerySchema.parse(c.req.query()),
        ),
      }),
    );
  }
  app.get("/v1/me", async (c) =>
    c.json({
      success: true,
      data: {
        ...(await service.me(c.get("principal"))),
        mediaAvailable: !!deps.media,
        ...(await speech.describe()),
      },
    }),
  );
  const setup = new ConnectionSetup(service);
  app.post("/v1/connect", async (c) => {
    const attempt = await setup.start(
      c.get("principal"),
      await body(c, connectSchema),
    );
    return c.json({
      success: true,
      data: {
        ...attempt,
        approvalUrl: `${deps.siteUrl}/app/connect/${attempt.id}`,
      },
    });
  });
  app.get("/v1/connect/:id", async (c) =>
    c.json({
      success: true,
      data: await setup.get(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.post("/v1/connect/:id/approve", async (c) =>
    c.json({
      success: true,
      data: await setup.approve(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        await body(c, approveConnectSchema),
      ),
    }),
  );
  app.post("/v1/connect/:id/cancel", async (c) => {
    await body(c, z.object({}).strict());
    return c.json({
      success: true,
      data: await setup.cancel(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    });
  });
  app.get("/v1/projects", async (c) =>
    c.json({
      success: true,
      data: await service.projects(
        c.get("principal"),
        z.enum(["active", "archived"]).parse(c.req.query("status") ?? "active"),
      ),
    }),
  );
  app.get("/v1/projects/:id/lifecycle", async (c) =>
    c.json({
      success: true,
      data: await service.previewProjectLifecycle(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  for (const action of ["archive", "restore", "delete"] as const)
    app.post(`/v1/projects/:id/${action}`, async (c) =>
      c.json({
        success: true,
        data: await service.projectLifecycle(
          c.get("principal"),
          uuidSchema.parse(c.req.param("id")),
          action,
          await body(c, notebookLifecycleSchema),
        ),
      }),
    );
  app.post("/v1/briefs", async (c) =>
    c.json({
      success: true,
      data: await service.brief(
        c.get("principal"),
        await body(c, briefRequestSchema),
      ),
    }),
  );
  app.post("/v1/briefs/refresh", async (c) =>
    c.json({
      success: true,
      data: await service.brief(
        c.get("principal"),
        await body(c, briefRequestSchema),
        true,
      ),
    }),
  );
  app.get("/v1/models", async (c) => {
    await service.access(c.get("principal"), "admin", async () => {});
    if (!deps.models)
      throw new GroveError(
        "unavailable",
        "Model settings are not available",
        503,
      );
    return c.json({
      success: true,
      data: deps.models.describe(c.get("principal")),
    });
  });
  app.patch("/v1/models", async (c) => {
    const input = await body(c, modelUpdateSchema);
    if (!deps.models)
      throw new GroveError(
        "unavailable",
        "Model settings are not available",
        503,
      );
    await deps.models.save(c.get("principal"), input);
    await deps.models.refresh();
    return c.json({
      success: true,
      data: deps.models.describe(c.get("principal")),
    });
  });
  app.post("/v1/models/test", async (c) => {
    const input = await body(
      c,
      z
        .object({ role: z.enum(["embedding", "decision", "generation"]) })
        .strict(),
    );
    if (!deps.models)
      throw new GroveError(
        "unavailable",
        "Model settings are not available",
        503,
      );
    await service.access(c.get("principal"), "admin", async () => {
      deps.models!.assertEditor(c.get("principal"));
    });
    const result = await deps.models.test(
      input.role,
      c.get("principal").accountId,
    );
    await service.access(c.get("principal"), "admin", async () => {
      deps.models!.assertEditor(c.get("principal"));
    });
    return c.json({ success: true, data: result });
  });
  app.get("/v1/account/usage", async (c) =>
    c.json({ success: true, data: await service.usage(c.get("principal")) }),
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
  app.post("/v1/relationships/search", async (c) =>
    c.json({
      success: true,
      data: await service.relationships.list(
        c.get("principal"),
        await body(c, connectionQuerySchema),
      ),
    }),
  );
  app.post("/v1/relationships/:level/:id/review", async (c) =>
    c.json({
      success: true,
      data: await service.relationships.review(
        c.get("principal"),
        connectionLevelSchema.parse(c.req.param("level")),
        uuidSchema.parse(c.req.param("id")),
        await mutation(c, connectionReviewSchema),
      ),
    }),
  );
  app.post("/v1/relationships/:level/:id/retry", async (c) =>
    c.json({
      success: true,
      data: await service.relationships.retry(
        c.get("principal"),
        connectionLevelSchema.parse(c.req.param("level")),
        uuidSchema.parse(c.req.param("id")),
      ),
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
  app.post("/v1/assistance", async (c) =>
    c.json({
      success: true,
      data: await service.assistance.request(
        c.get("principal"),
        await body(c, assistanceRequestSchema),
      ),
    }),
  );
  app.get("/v1/assistance/:id", async (c) =>
    c.json({
      success: true,
      data: await service.assistance.get(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  for (const action of ["apply", "undo"] as const)
    app.post(`/v1/assistance/:id/${action}`, async (c) =>
      c.json({
        success: true,
        data: await service.assistance.apply(
          c.get("principal"),
          uuidSchema.parse(c.req.param("id")),
          await body(c, assistanceApplySchema),
          action === "undo",
        ),
      }),
    );
  app.post("/v1/assistance/:id/review", async (c) =>
    c.json({
      success: true,
      data: await service.assistance.review(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        await body(c, assistanceReviewSchema),
      ),
    }),
  );
  app.post("/v1/notebook-visits", async (c) =>
    c.json({
      success: true,
      data: await service.visits.acknowledge(
        c.get("principal"),
        await body(c, notebookVisitSchema),
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
  app.get("/v1/memories/:id/revisions/:version", async (c) =>
    c.json({
      success: true,
      data: await service.sourceRevision(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        z.coerce
          .number()
          .int()
          .positive()
          .max(2147483647)
          .parse(c.req.param("version")),
      ),
    }),
  );
  app.post("/v1/memories/:id/reprocess", async (c) => {
    const input = await body(
      c,
      z.object({ expectedVersion: z.number().int().positive() }).strict(),
    );
    return c.json({
      success: true,
      data: await service.retryProcessing(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        input.expectedVersion,
      ),
    });
  });
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
        c.get("signal"),
      ),
    }),
  );
  app.get("/v1/ask-tools", async (c) =>
    c.json({
      success: true,
      data: await service.access(
        c.get("principal"),
        "admin",
        async ({ account }) => {
          return {
            defaults: askToolsSchema.parse(account.askTools ?? defaultAskTools),
            available: {
              exa: !!service.research.exa,
              tavily: !!service.research.tavily,
              organize: true,
            },
            dailyCalls: service.researchLimits.dailyCalls,
          };
        },
      ),
    }),
  );
  app.patch("/v1/conversations/:id/tools", async (c) =>
    c.json({
      success: true,
      data: await service.conversations.configureTools(
        c.get("principal"),
        c.req.param("id"),
        await body(c, toolSettingsSchema),
      ),
    }),
  );
  app.post("/v1/conversations/search", async (c) =>
    c.json({
      success: true,
      data: await searchConversationHistory(
        service,
        c.get("principal"),
        await body(c, conversationHistorySchema),
      ),
    }),
  );
  app.get("/v1/conversations", async (c) =>
    c.json({
      success: true,
      data: await service.conversations.list(
        c.get("principal"),
        z.uuid().optional().parse(c.req.query("after")),
      ),
    }),
  );
  app.post("/v1/conversations", async (c) =>
    c.json({
      success: true,
      data: await service.conversations.create(
        c.get("principal"),
        await body(c, conversationCreateSchema),
      ),
    }),
  );
  app.get("/v1/conversations/:id", async (c) =>
    c.json({
      success: true,
      data: await service.conversations.get(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.delete("/v1/conversations/:id", async (c) =>
    c.json({
      success: true,
      data: await service.conversations.remove(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  app.post("/v1/conversations/:id/turns", async (c) =>
    c.json({
      success: true,
      data: await service.conversations.turn(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        await body(c, conversationTurnSchema),
        c.get("signal"),
      ),
    }),
  );
  app.post("/v1/conversations/:id/turns/:turnId/:action", async (c) => {
    const action = z.enum(["apply", "undo"]).parse(c.req.param("action"));
    await body(c, z.object({}).strict());
    return c.json({
      success: true,
      data: await service.conversations.apply(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
        uuidSchema.parse(c.req.param("turnId")),
        action === "undo",
      ),
    });
  });
  app.post("/v1/ask", async (c) =>
    c.json({
      success: true,
      data: await service.ask(
        c.get("principal"),
        await body(c, askSchema),
        c.get("signal"),
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
        await body(c, settingsUpdateSchema),
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
  const tasks = new Tasks(service, !!deps.artifacts);
  app.get("/v1/account/export", async (c) => {
    await service.access(c.get("principal"), "admin", async () => {});
    throw new GroveError(
      "export_moved",
      "Create an export with POST /v1/exports",
      410,
    );
  });
  app.post("/v1/exports", async (c) =>
    c.json(
      {
        success: true,
        data: await tasks.export(
          c.get("principal"),
          await body(c, exportRequestSchema),
        ),
      },
      202,
    ),
  );
  app.post("/v1/imports", async (c) =>
    c.json(
      {
        success: true,
        data: await tasks.import(
          c.get("principal"),
          await body(c, importRequestSchema),
        ),
      },
      202,
    ),
  );
  app.get("/v1/tasks", async (c) =>
    c.json({
      success: true,
      data: await tasks.list(
        c.get("principal"),
        z.uuid().optional().parse(c.req.query("projectId")),
      ),
    }),
  );
  app.get("/v1/tasks/:id", async (c) =>
    c.json({
      success: true,
      data: await tasks.get(
        c.get("principal"),
        uuidSchema.parse(c.req.param("id")),
      ),
    }),
  );
  for (const action of ["cancel", "retry"] as const)
    app.post(`/v1/tasks/:id/${action}`, async (c) =>
      c.json({
        success: true,
        data: await tasks.action(
          c.get("principal"),
          uuidSchema.parse(c.req.param("id")),
          action,
        ),
      }),
    );
  app.get("/v1/tasks/:id/download", async (c) => {
    const principal = c.get("principal"),
      id = uuidSchema.parse(c.req.param("id"));
    const artifact = await tasks.artifact(principal, id);
    if (!deps.artifacts)
      throw new GroveError(
        "exports_unavailable",
        "Export storage is not configured",
        503,
      );
    const cancelled = new AbortController();
    const signal = AbortSignal.any([c.get("signal"), cancelled.signal]);
    const source = await deps.artifacts.read(artifact.key, signal);
    const stream = new PassThrough();
    const response = Readable.toWeb(stream) as ReadableStream;
    stream.once("close", () => {
      if (!stream.readableEnded) cancelled.abort();
    });
    c.set("streaming", true);
    void pipeline(
      source,
      async function* (input) {
        let checked = Date.now();
        for await (const chunk of input) {
          if (Date.now() - checked >= 5000) {
            await withDatabaseSignal(signal, () =>
              tasks.artifact(principal, id),
            );
            checked = Date.now();
          }
          yield chunk;
        }
      },
      stream,
      { signal },
    )
      .catch(() => {
        // pipeline errors reach the response body; never report a partial export
        // as a complete download or log storage credentials/object contents.
        console.error(
          JSON.stringify({
            requestId: c.get("requestId"),
            code: "export_interrupted",
          }),
        );
      })
      .finally(c.get("finish"));
    c.header(
      "Content-Disposition",
      `attachment; filename="${artifact.filename}"`,
    );
    c.header("Content-Type", "application/x-ndjson");
    c.header("Content-Length", String(artifact.bytes));
    return c.body(response);
  });
  app.all("/mcp", async (c) => {
    const principal = c.get("principal");
    await service.me(principal);
    const execute = async (
      tool: ToolName,
      value: unknown,
      signal?: AbortSignal,
    ) =>
      withDatabaseSignal(
        AbortSignal.any([databaseSignal()!, ...(signal ? [signal] : [])]),
        () => executeMemoryTool(service, principal, tool, value, signal),
      );
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
