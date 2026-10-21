import type { BrowserOptions, ErrorEvent, Log, Metric } from "@sentry/nextjs";
import { operations, origin, pagePath } from "./analytics-policy";
type StreamedSpanJSON = Parameters<
  NonNullable<BrowserOptions["beforeSendSpan"]>
>[0];

export const dataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};
function codeFile(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.replace(/[?#].*$/, "");
  const chunk = path.match(/\/_next\/static\/[a-zA-Z0-9_./[\]@()-]+\.js$/);
  if (chunk) return `${origin}${chunk[0]}`;
  const server = path.match(
    /(?:\.next\/server|src)\/[a-zA-Z0-9_./[\]@()-]+\.[cm]?[jt]sx?$/,
  );
  return server ? `app:///${server[0]}` : undefined;
}
export function sanitizeError(event: ErrorEvent): ErrorEvent {
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    environment: "production",
    sdk: event.sdk,
    tags: { product: "grove", surface: "website" },
    exception: {
      values: event.exception?.values?.map((exception) => ({
        type: [
          "Error",
          "TypeError",
          "RangeError",
          "ReferenceError",
          "SyntaxError",
          "URIError",
          "EvalError",
        ].includes(exception.type ?? "")
          ? exception.type
          : "Error",
        value: "Website error (details redacted)",
        mechanism: exception.mechanism
          ? {
              type: exception.mechanism.type,
              handled: exception.mechanism.handled,
            }
          : undefined,
        stacktrace: {
          frames: exception.stacktrace?.frames?.map((frame) => ({
            filename: codeFile(frame.filename),
            abs_path: codeFile(frame.abs_path),
            function: frame.function
              ?.replace(/[^a-zA-Z0-9_.$<> [\]-]/g, "")
              .slice(0, 120),
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        },
      })),
    },
    debug_meta: event.debug_meta
      ? {
          images: event.debug_meta.images?.flatMap((image) => {
            const file = codeFile(image.code_file);
            return image.type === "sourcemap" && file
              ? [
                  {
                    type: "sourcemap" as const,
                    code_file: file,
                    debug_id: image.debug_id,
                  },
                ]
              : [];
          }),
        }
      : undefined,
    contexts: event.contexts?.trace
      ? {
          trace: {
            trace_id: event.contexts.trace.trace_id,
            span_id: event.contexts.trace.span_id,
            parent_span_id: event.contexts.trace.parent_span_id,
          },
        }
      : undefined,
  };
}
export function sanitizeSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  const rawOp = span.attributes["sentry.op"];
  const op =
    typeof rawOp === "string" &&
    /^(pageload|navigation|http\.server|http\.client|resource\.[a-z]+|ui\.[a-z.]+)$/.test(
      rawOp,
    )
      ? rawOp
      : "website.operation";
  return {
    trace_id: span.trace_id,
    span_id: span.span_id,
    parent_span_id: span.parent_span_id,
    start_timestamp: span.start_timestamp,
    end_timestamp: span.end_timestamp,
    status: span.status,
    is_segment: span.is_segment,
    name: ["pageload", "navigation", "http.server"].includes(op)
      ? pagePath(span.name)
      : op,
    attributes: {
      "sentry.op": op,
      product: "grove",
      surface: "website",
      environment: "production",
      "sentry.release": process.env.NEXT_PUBLIC_TELEMETRY_RELEASE,
    },
  };
}
function outcomeAttributes(input: Record<string, unknown> = {}) {
  return {
    product: "grove",
    surface: input.surface === "workspace" ? "workspace" : "website",
    environment: "production",
    "sentry.release": process.env.NEXT_PUBLIC_TELEMETRY_RELEASE,
    outcome: ["success", "error"].includes(String(input.outcome))
      ? input.outcome
      : "unavailable",
    operation: (operations as readonly unknown[]).includes(input.operation)
      ? input.operation
      : "workspace_read",
  };
}
export function sanitizeLog(log: Log): Log | null {
  return log.message === "Website operation completed"
    ? {
        level: "info",
        message: log.message,
        attributes: outcomeAttributes(log.attributes),
      }
    : null;
}
export function sanitizeMetric(metric: Metric): Metric | null {
  return ["website.operation.count", "website.operation.duration"].includes(
    metric.name,
  ) && Number.isFinite(metric.value)
    ? {
        name: metric.name,
        type: metric.type,
        unit: metric.unit,
        value: Math.max(0, Math.min(metric.value, 300_000)),
        attributes: outcomeAttributes(metric.attributes),
      }
    : null;
}
