import type { ErrorEvent, Log, Metric, StreamedSpanJSON } from "@sentry/core";

export const surfaces = [
  "api",
  "worker",
  "cli",
  "mcp",
  "opencode",
  "claude",
  "codex",
] as const;
export type Surface = (typeof surfaces)[number];
export const operations = [
  "http_request",
  "memory_write",
  "memory_recall",
  "chat",
  "notebook_write",
  "agent_connect",
  "agent_context",
  "mcp_tool",
  "command_run",
  "job_run",
  "maintenance",
  "model_request",
] as const;
export type Operation = (typeof operations)[number];
export const events = [
  "operation_completed",
  "command_completed",
  "agent_connected",
  "workspace_created",
  "notebook_created",
  "memory_created",
  "memory_recalled",
  "chat_completed",
  "$ai_generation",
] as const;
export type EventName = (typeof events)[number];
export type Outcome = "success" | "unavailable" | "error" | "cancelled";
export type Properties = {
  operation?: Operation;
  outcome?: Outcome;
  command?:
    | "connect"
    | "init"
    | "login"
    | "status"
    | "project"
    | "logout"
    | "pause"
    | "resume"
    | "uninstall"
    | "mcp"
    | "serve";
  agent?: "cli" | "opencode" | "claude" | "codex";
  provider?: "deepinfra" | "minimax" | "local" | "custom";
  model_role?: "embedding" | "decision" | "generation";
  duration_ms?: number;
  result_count?: number;
  input_tokens?: number;
  output_tokens?: number;
};
export function projectProperties(
  input: Record<string, unknown> = {},
): Properties {
  const output: Record<string, unknown> = {};
  const enums = {
    operation: operations,
    outcome: ["success", "unavailable", "error", "cancelled"],
    command: [
      "connect",
      "init",
      "login",
      "status",
      "project",
      "logout",
      "pause",
      "resume",
      "uninstall",
      "mcp",
      "serve",
    ],
    agent: ["cli", "opencode", "claude", "codex"],
    provider: ["deepinfra", "minimax", "local", "custom"],
    model_role: ["embedding", "decision", "generation"],
  };
  for (const [key, choices] of Object.entries(enums))
    if ((choices as readonly unknown[]).includes(input[key]))
      output[key] = input[key];
  for (const key of [
    "duration_ms",
    "result_count",
    "input_tokens",
    "output_tokens",
  ] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value))
      output[key] = Math.max(
        0,
        Math.min(value, key === "duration_ms" ? 300_000 : 1_000_000),
      );
  }
  return output as Properties;
}
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
export type Identity = { surface: Surface; release: string; version: string };
const attributes = (identity: Identity, raw: Record<string, unknown> = {}) => ({
  ...projectProperties(raw),
  product: "grove",
  surface: identity.surface,
  environment: "production",
  "sentry.release": identity.release,
});
function codeFile(value?: string) {
  // Only our emitted entrypoints have uploaded maps. Never send a local prefix,
  // agent workspace, arbitrary dependency path or generated filename.
  const name = value
    ?.replace(/[?#].*$/, "")
    .match(/(?:^|\/)(server|worker|cli|bridge|hook|index)\.js$/)?.[1];
  return name ? `app:///${name}.js` : undefined;
}
export function safeError(event: ErrorEvent, identity: Identity): ErrorEvent {
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: "error",
    platform: "node",
    environment: "production",
    release: identity.release,
    tags: attributes(identity, event.tags),
    exception: {
      values: event.exception?.values?.slice(0, 1).map((exception) => ({
        type: "OperationError",
        value: "Grove operation failed (details redacted)",
        stacktrace: {
          frames: exception.stacktrace?.frames?.slice(-40).flatMap((frame) => {
            const file = codeFile(frame.filename ?? frame.abs_path);
            return file
              ? [
                  {
                    filename: file,
                    abs_path: file,
                    lineno: frame.lineno,
                    colno: frame.colno,
                    in_app: true,
                  },
                ]
              : [];
          }),
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
  };
}
export function safeSpan(
  span: StreamedSpanJSON,
  identity: Identity,
): StreamedSpanJSON {
  const properties = projectProperties(span.attributes);
  return {
    trace_id: span.trace_id,
    span_id: span.span_id,
    start_timestamp: span.start_timestamp,
    end_timestamp: span.end_timestamp,
    status: span.status,
    is_segment: span.is_segment,
    name: properties.operation ?? "command_run",
    attributes: {
      ...attributes(identity, span.attributes),
      "sentry.op": "grove.operation",
    },
  };
}
export function safeLog(log: Log, identity: Identity): Log | null {
  return log.message === "Grove operation completed"
    ? {
        level: "info",
        message: log.message,
        attributes: attributes(identity, log.attributes),
      }
    : null;
}
export function safeMetric(metric: Metric, identity: Identity): Metric | null {
  if (
    !["grove.operation.count", "grove.operation.duration"].includes(
      metric.name,
    ) ||
    !Number.isFinite(metric.value)
  )
    return null;
  return {
    name: metric.name,
    type: metric.type,
    unit: metric.unit,
    value: Math.max(0, Math.min(metric.value, 300_000)),
    attributes: attributes(identity, metric.attributes),
  };
}
