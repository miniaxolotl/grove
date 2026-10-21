import { createHmac, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PostHog } from "posthog-node";
import {
  Scope,
  createTransport,
  logger,
  metrics,
  startInactiveSpan,
  withScope,
  type ErrorEvent,
} from "@sentry/core";
import { ServerRuntimeClient } from "@sentry/core/server";
import { defaultStackParser } from "@sentry/node";
import {
  dataCollection,
  events,
  operations,
  projectProperties,
  safeError,
  safeLog,
  safeMetric,
  safeSpan,
  safeSpanEnvelope,
  surfaces,
  type EventName,
  type Identity,
  type Operation,
  type Outcome,
  type Properties,
  type Surface,
} from "./policy.ts";
import {
  environmentDisabled,
  identityAllowed,
  installationIdentity,
  resetTelemetryIdentity,
  telemetryDirectory,
} from "./preference.ts";
import type { TelemetrySink } from "./context.ts";

export type {
  EventName,
  Operation,
  Outcome,
  Properties,
  Surface,
} from "./policy.ts";
export type Configuration = {
  enabled: boolean;
  surface: Surface;
  revision: string;
  version: string;
  component?: "api" | "cli" | "opencode";
  key?: string;
  dsn?: string;
  identity: string;
  allowed: () => boolean;
  posthogHost?: string;
  sampleRate?: number;
};
type Record = {
  event: EventName;
  properties: Properties;
  identity: string;
  started?: number;
  ended?: number;
  error?: ErrorEvent;
};
const opaqueIdentity = (value: string) =>
  /^[a-f0-9-]{36}$/.test(value) || /^[a-f0-9]{64}$/.test(value);

/** An isolated client, not Sentry.init(): host-agent handlers and context strategy
 * are never replaced. Only explicit content-free operations enter this queue. */
export class Reporter implements TelemetrySink {
  private posthog?: PostHog;
  private posthogRetryAfter = 0;
  private sentry?: ServerRuntimeClient;
  private queue: Record[] = [];
  private scheduled?: NodeJS.Immediate;
  private stopped = false;
  private requests = new AbortController();
  private closing = false;
  private identity: Identity;
  constructor(private config: Configuration) {
    this.identity = {
      surface: config.surface,
      release: `grove-${config.component ?? (["api", "worker"].includes(config.surface) ? "api" : "cli")}@${config.revision}`,
      version: config.version,
    };
    if (
      !config.enabled ||
      !/^[a-f0-9]{40}$/.test(config.revision) ||
      !/^\d+\.\d+\.\d+$/.test(config.version) ||
      !(surfaces as readonly string[]).includes(config.surface) ||
      !opaqueIdentity(config.identity) ||
      !this.allowed()
    ) {
      this.stopped = true;
      return;
    }
    try {
      if (config.key?.startsWith("phc_")) {
        this.posthog = new PostHog(config.key, {
          host: config.posthogHost ?? "https://us.i.posthog.com",
          persistence: "memory",
          flushAt: 20,
          flushInterval: 2000,
          maxQueueSize: 128,
          fetchRetryCount: 0,
          requestTimeout: 500,
          disableGeoip: true,
          enableExceptionAutocapture: false,
          enableLocalEvaluation: false,
          before_send: (event) => {
            if (
              !this.allowed() ||
              !(events as readonly string[]).includes(event.event) ||
              typeof event.distinctId !== "string" ||
              !opaqueIdentity(event.distinctId)
            )
              return null;
            const properties = projectProperties(event.properties);
            return {
              event: event.event,
              distinctId: event.distinctId,
              timestamp: event.timestamp,
              uuid: event.uuid,
              properties: {
                ...properties,
                product: "grove",
                surface: this.identity.surface,
                environment: "production",
                version: this.identity.version,
                release: this.identity.release,
                $process_person_profile: false,
                $geoip_disable: true,
                ...(event.event === "$ai_generation"
                  ? {
                      $ai_provider: properties.provider,
                      $ai_model: properties.model_role,
                      $ai_input_tokens: properties.input_tokens,
                      $ai_output_tokens: properties.output_tokens,
                      $ai_latency: (properties.duration_ms ?? 0) / 1000,
                    }
                  : {}),
              },
            };
          },
          fetch: async (url, options) => {
            const discarded = {
              status: 200,
              text: async () => "{}",
              json: async () => ({}),
            };
            if (!this.allowed() || performance.now() < this.posthogRetryAfter)
              return discarded;
            try {
              const response = await fetch(url, {
                ...options,
                signal: AbortSignal.any([
                  this.requests.signal,
                  AbortSignal.timeout(350),
                ]),
                redirect: "error",
              });
              // Capture acknowledgements need no response content. Do not let a
              // slow/hostile response body outlive our upload deadline or reach
              // the SDK's diagnostic logger.
              void response.body?.cancel().catch(() => {});
              if (response.ok) return discarded;
            } catch {
              /* Drop rather than let SDK shutdown print provider bodies or host paths to stderr. */
            }
            this.posthogRetryAfter = performance.now() + 30_000;
            return discarded;
          },
        });
        // Errors have no bearing on product behavior and may contain provider data.
        this.posthog.on("error", () => {});
      }
    } catch {
      /* Each provider fails independently. */
    }
    try {
      if (config.dsn) {
        this.sentry = new ServerRuntimeClient({
          dsn: config.dsn,
          platform: "node",
          runtime: { name: "node", version: process.version },
          environment: "production",
          release: this.identity.release,
          integrations: [],
          stackParser: defaultStackParser,
          sendClientReports: false,
          dataCollection,
          enableLogs: true,
          enableMetrics: true,
          tracesSampleRate: config.sampleRate ?? 0.1,
          traceLifecycle: "stream",
          tracePropagationTargets: [],
          beforeBreadcrumb: () => null,
          beforeSend: (event) =>
            this.allowed() ? safeError(event, this.identity) : null,
          beforeSendSpan: (span) => safeSpan(span, this.identity),
          beforeSendLog: (log) =>
            this.allowed() ? safeLog(log, this.identity) : null,
          beforeSendMetric: (metric) =>
            this.allowed() ? safeMetric(metric, this.identity) : null,
          transport: (options) => {
            const transport = createTransport(
              { ...options, bufferSize: 8 },
              async (request) => {
                if (!this.allowed()) return { statusCode: 200 };
                const response = await fetch(options.url, {
                  method: "POST",
                  body: request.body as BodyInit,
                  headers: { "Content-Type": "application/x-sentry-envelope" },
                  signal: AbortSignal.any([
                    this.requests.signal,
                    AbortSignal.timeout(500),
                  ]),
                  redirect: "error",
                });
                await response.body?.cancel();
                return {
                  statusCode: response.status,
                  headers: {
                    "retry-after": response.headers.get("retry-after"),
                    "x-sentry-rate-limits": response.headers.get(
                      "x-sentry-rate-limits",
                    ),
                  },
                };
              },
            );
            return {
              ...transport,
              send: (envelope) => {
                if (!this.allowed())
                  return Promise.resolve({ statusCode: 200 });
                const projected = safeSpanEnvelope(
                  envelope,
                  this.identity,
                  config.dsn!,
                  config.sampleRate ?? 0.1,
                );
                return projected
                  ? transport.send(projected)
                  : Promise.resolve({ statusCode: 200 });
              },
            };
          },
        });
        this.sentry.init();
      }
    } catch {
      /* Each provider fails independently. */
    }
  }
  private allowed() {
    if (this.stopped) return false;
    try {
      if (this.config.allowed()) return true;
    } catch {
      /* Fail closed. */
    }
    this.stopped = true;
    this.queue.length = 0;
    return false;
  }
  capture(
    event: EventName,
    properties: Properties = {},
    identity = this.config.identity,
  ) {
    if (
      !(events as readonly string[]).includes(event) ||
      !opaqueIdentity(identity)
    )
      return;
    this.enqueue({
      event,
      properties: projectProperties(properties),
      identity,
    });
  }
  stop() {
    this.stopped = true;
    this.queue.length = 0;
    this.requests.abort();
  }
  operation(
    operation: Operation,
    started: number,
    outcome: Outcome,
    properties: Properties = {},
    cause?: unknown,
    identity = this.config.identity,
  ) {
    if (
      !(operations as readonly string[]).includes(operation) ||
      !Number.isFinite(started) ||
      !opaqueIdentity(identity)
    )
      return;
    const ended = performance.now();
    this.enqueue({
      event: "operation_completed",
      properties: projectProperties({
        ...properties,
        operation,
        outcome,
        duration_ms: ended - started,
      }),
      identity,
      started:
        Date.now() / 1000 -
        Math.max(0, Math.min(ended - started, 300000)) / 1000,
      ended: Date.now() / 1000,
      error:
        outcome === "error"
          ? safeError(
              {
                type: undefined,
                tags: { operation, outcome },
                exception: {
                  values: [
                    {
                      type: "OperationError",
                      value: "redacted",
                      stacktrace: {
                        frames: defaultStackParser(
                          (cause instanceof Error
                            ? cause.stack
                            : new Error("Grove operation failed").stack) ?? "",
                        ),
                      },
                    },
                  ],
                },
              },
              this.identity,
            )
          : undefined,
    });
  }
  forIdentity(identity: string, enabled = true): TelemetrySink {
    return {
      capture: (event, properties) => {
        if (enabled) this.capture(event, properties, identity);
      },
      operation: (operation, started, outcome, properties, error) => {
        if (enabled)
          this.operation(
            operation,
            started,
            outcome,
            properties,
            error,
            identity,
          );
      },
    };
  }
  private enqueue(item: Record) {
    if (this.stopped || this.closing || this.queue.length >= 128) return;
    this.queue.push(item);
    this.scheduled ??= setImmediate(() => {
      this.scheduled = undefined;
      this.drain();
    });
    this.scheduled.unref();
  }
  private drain() {
    for (const item of this.queue.splice(0)) {
      if (!this.allowed()) return;
      try {
        this.posthog?.capture({
          event: item.event,
          distinctId: item.identity,
          properties: item.properties,
        });
      } catch {
        /* Independent sinks. */
      }
      if (item.event !== "operation_completed" || !this.sentry) continue;
      try {
        const client = this.sentry;
        const scope = new Scope();
        scope.setClient(client);
        scope.setTags({
          operation: item.properties.operation,
          outcome: item.properties.outcome,
        });
        // No application awaits inside a shared SDK scope. Both start and end
        // happen here so v11 emits through this client's streamed transport.
        withScope(scope, () => {
          const span = startInactiveSpan({
            parentSpan: null,
            scope,
            name: item.properties.operation!,
            op: "grove.operation",
            startTime: item.started,
            attributes: { ...item.properties },
          });
          span.setStatus({
            code: item.properties.outcome === "success" ? 1 : 2,
          });
          metrics.count("grove.operation.count", 1, {
            attributes: { ...item.properties },
          });
          metrics.distribution(
            "grove.operation.duration",
            item.properties.duration_ms ?? 0,
            { unit: "millisecond", attributes: { ...item.properties } },
          );
          if (
            item.properties.outcome !== "success" ||
            ["agent_connect", "command_run", "maintenance"].includes(
              item.properties.operation!,
            )
          )
            logger.info("Grove operation completed", { ...item.properties });
          if (item.error) client.captureEvent(item.error, {}, scope);
          span.end(item.ended);
        });
      } catch {
        /* Diagnostic SDK failures never escape. */
      }
    }
  }
  async close(timeoutMs = 550) {
    if (this.closing) return;
    this.closing = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    this.drain();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.allSettled([
          this.posthog?.shutdown(500),
          this.sentry?.close(Math.min(500, timeoutMs)),
        ]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.stopped = true;
      this.requests.abort();
    }
  }
}

type Build = {
  enabled: boolean;
  revision: string;
  version: string;
  component?: "api" | "cli" | "opencode";
  key: string;
  cliDsn: string;
  apiDsn: string;
};
declare const __GROVE_TELEMETRY__: Build;
const build: Build =
  typeof __GROVE_TELEMETRY__ === "undefined"
    ? {
        enabled: false,
        revision: "",
        version: "",
        key: "",
        cliDsn: "",
        apiDsn: "",
      }
    : __GROVE_TELEMETRY__;
const reporters = new Map<Surface, Reporter>();
export function telemetry(surface: Surface) {
  let reporter = reporters.get(surface);
  if (reporter) return reporter;
  const server = surface === "api" || surface === "worker";
  const enabled =
    build.enabled &&
    !environmentDisabled() &&
    (!server || process.env.GROVE_TELEMETRY_ENABLED === "true");
  const directory = telemetryDirectory();
  const identity = enabled
    ? server
      ? randomUUID()
      : installationIdentity(directory)
    : "";
  reporter = new Reporter({
    ...build,
    enabled,
    surface,
    identity,
    dsn: server ? build.apiDsn : build.cliDsn,
    allowed: () =>
      !environmentDisabled() &&
      (server
        ? process.env.GROVE_TELEMETRY_ENABLED === "true"
        : identityAllowed(identity, directory)),
  });
  reporters.set(surface, reporter);
  return reporter;
}
export function accountIdentity(account: string) {
  const salt = process.env.GROVE_TELEMETRY_SALT;
  return salt && salt.length >= 32
    ? createHmac("sha256", salt)
        .update(`grove-account:${account}`)
        .digest("hex")
    : "";
}
export const closeTelemetry = (timeoutMs = 550) =>
  Promise.allSettled(
    [...reporters.values()].map((reporter) => reporter.close(timeoutMs)),
  );
export function resetLocalTelemetry() {
  for (const [surface, reporter] of reporters) {
    if (surface === "api" || surface === "worker") continue;
    reporter.stop();
    void reporter.close();
    reporters.delete(surface);
  }
  try {
    resetTelemetryIdentity();
  } catch {
    /* Credentials remain independent of telemetry storage. */
  }
}
