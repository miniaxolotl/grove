import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { getClient, getCurrentScope, getGlobalScope } from "@sentry/core";
import { ServerRuntimeClient } from "@sentry/core/server";
import { Reporter, type Configuration, type Properties } from "@lib/telemetry";
import {
  identityAllowed,
  installationIdentity,
  setTelemetryEnabled,
} from "@lib/telemetry/preference";

async function sink(
  hang: boolean | "body" = false,
  onRequest?: (request: { url: string; data: string }) => void,
) {
  const requests: { url: string; data: string }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    requests.push({
      url: request.url!,
      data: (raw[0] === 0x1f && raw[1] === 0x8b
        ? gunzipSync(raw)
        : raw
      ).toString(),
    });
    onRequest?.(requests.at(-1)!);
    if (!hang)
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    else if (hang === "body") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
      response.write('{"PRIVATE_BODY":"');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    requests,
    config: {
      enabled: true,
      surface: "cli",
      revision: "a".repeat(40),
      version: "1.5.0",
      key: "phc_test_only",
      dsn: `http://00000000000000000000000000000000@127.0.0.1:${port}/1`,
      identity: randomUUID(),
      allowed: () => true,
      sampleRate: 1,
      posthogHost: `http://127.0.0.1:${port}`,
    } satisfies Configuration,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
const eventBatches = (requests: { url: string; data: string }[]) =>
  requests
    .filter((r) => !r.url.includes("envelope"))
    .flatMap((r) => {
      const value = JSON.parse(r.data);
      return value.batch ?? [value];
    });

test("real Node SDKs serialize only bounded metadata and preserve the host's SDK scope and handlers", async () => {
  const endpoint = await sink();
  const client = getClient();
  const scope = getGlobalScope();
  scope.setUser({ email: "PRIVATE_PERSON" });
  scope.setExtra("transcript", "PRIVATE_TRANSCRIPT");
  const handlers = [
    process.listenerCount("uncaughtException"),
    process.listenerCount("unhandledRejection"),
  ];
  try {
    const reporter = new Reporter(endpoint.config);
    reporter.capture("memory_created", {
      result_count: 1,
      email: "PRIVATE_PERSON",
      content: "PRIVATE_NOTE",
      url: "https://private.example/?secret=PRIVATE_SECRET",
    } as Properties);
    reporter.capture("$ai_generation", {
      provider: "custom",
      model_role: "generation",
      input_tokens: 20,
      output_tokens: 5,
      duration_ms: 12,
      prompt: "PRIVATE_PROMPT",
      response: "PRIVATE_RESPONSE",
    } as Properties);
    const error = new Error("PRIVATE_EXCEPTION");
    error.stack =
      "Error: PRIVATE_EXCEPTION\n    at privateFunction (/home/PRIVATE_WORKSPACE/dist/cli.js:12:34)\n    at another (/private/secret.js:3:4)";
    reporter.operation(
      "command_run",
      performance.now() - 25,
      "error",
      {
        command: "connect",
        agent: "opencode",
      },
      error,
    );
    await reporter.close();
    const all = JSON.stringify(endpoint.requests);
    assert.ok(!all.includes("PRIVATE"), all);
    assert.ok(!all.includes(process.cwd()));
    const events = eventBatches(endpoint.requests);
    assert.deepEqual(
      new Set(events.map((e) => e.event)),
      new Set(["memory_created", "$ai_generation", "operation_completed"]),
    );
    for (const event of events) {
      assert.equal(
        event.distinct_id ?? event.properties.distinct_id,
        endpoint.config.identity,
      );
      assert.equal(event.properties.$process_person_profile, false);
      assert.equal(event.properties.environment, "production");
      assert.equal(event.properties.release, `grove-cli@${"a".repeat(40)}`);
    }
    const envelopes = endpoint.requests
      .filter((r) => r.url.includes("envelope"))
      .flatMap((r) => {
        const lines = r.data.trim().split("\n");
        return Array.from({ length: (lines.length - 1) / 2 }, (_, i) => ({
          headers: JSON.parse(lines[0]),
          type: JSON.parse(lines[1 + i * 2]).type,
          data: JSON.parse(lines[2 + i * 2]),
        }));
      });
    assert.deepEqual(
      new Set(envelopes.map((item) => item.type)),
      new Set(["event", "span", "log", "trace_metric"]),
    );
    const span = envelopes.find((item) => item.type === "span")!;
    assert.equal(
      span.headers.trace?.public_key,
      "00000000000000000000000000000000",
      "Sentry rejects a streamed span without its own project's sampling context",
    );
    assert.equal(span.headers.trace.trace_id, span.data.items[0].trace_id);
    assert.equal(span.headers.trace.release, `grove-cli@${"a".repeat(40)}`);
    assert.equal(span.headers.trace.transaction, "command_run");
    assert.equal(span.headers.trace.sample_rate, "1");
    assert.deepEqual(
      envelopes.find((item) => item.type === "event")?.data.exception.values[0]
        .stacktrace.frames,
      [
        {
          filename: "app:///cli.js",
          abs_path: "app:///cli.js",
          lineno: 12,
          colno: 34,
          in_app: true,
        },
      ],
    );
    assert.equal(getClient(), client);
    assert.equal(scope.getScopeData().user.email, "PRIVATE_PERSON");
    assert.deepEqual(
      [
        process.listenerCount("uncaughtException"),
        process.listenerCount("unhandledRejection"),
      ],
      handlers,
    );
  } finally {
    scope.setUser(null);
    scope.setExtra("transcript", undefined);
    await endpoint.close();
  }
});

test("timer-flushed spans retain Grove sampling provenance with another host client active", async () => {
  let delivered!: () => void;
  const received = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const endpoint = await sink(false, (request) => {
    if (
      request.url.includes("envelope") &&
      request.data.includes('"type":"span"')
    )
      delivered();
  });
  const scope = getCurrentScope();
  const previous = scope.getClient();
  const propagation = scope.getPropagationContext();
  const host = new ServerRuntimeClient({
    dsn: endpoint.config.dsn.replace(
      "00000000000000000000000000000000",
      "11111111111111111111111111111111",
    ),
    environment: "PRIVATE_HOST_ENVIRONMENT",
    release: "PRIVATE_HOST_RELEASE",
    integrations: [],
    tracesSampleRate: 1,
    stackParser: () => [],
    transport: () => ({
      send: async () => ({ statusCode: 200 }),
      flush: async () => true,
    }),
  });
  scope.setClient(host);
  scope.setPropagationContext({
    traceId: "f".repeat(32),
    sampleRand: 0.01,
    dsc: {
      trace_id: "f".repeat(32),
      public_key: "11111111111111111111111111111111",
      transaction: "PRIVATE_HOST_TRANSACTION",
    },
  });
  const reporter = new Reporter(endpoint.config);
  let timeout: NodeJS.Timeout | undefined;
  try {
    reporter.operation("maintenance", performance.now() - 10, "success");
    await Promise.race([
      received,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("SDK timer did not deliver a span")),
          8000,
        );
      }),
    ]);
    await reporter.close();
    assert.equal(getClient(), host);
    assert.equal(scope.getPropagationContext().traceId, "f".repeat(32));
    assert.ok(!JSON.stringify(endpoint.requests).includes("PRIVATE"));
    const request = endpoint.requests.find((r) =>
      r.data.includes('"type":"span"'),
    )!;
    const lines = request.data.trim().split("\n");
    const { trace } = JSON.parse(lines[0]);
    assert.equal(trace.public_key, "00000000000000000000000000000000");
    assert.equal(trace.release, `grove-cli@${"a".repeat(40)}`);
    assert.equal(trace.environment, "production");
    assert.equal(trace.transaction, "maintenance");
    assert.equal(trace.trace_id, JSON.parse(lines[2]).items[0].trace_id);
    assert.notEqual(trace.trace_id, "f".repeat(32));
  } finally {
    if (timeout) clearTimeout(timeout);
    scope.setClient(previous);
    scope.setPropagationContext(propagation);
    await reporter.close();
    await host.close();
    await endpoint.close();
  }
});

test("queued events and all Sentry envelope types recheck opt-out before upload", async () => {
  const endpoint = await sink();
  let enabled = true;
  try {
    const reporter = new Reporter({
      ...endpoint.config,
      allowed: () => enabled,
    });
    reporter.capture("agent_connected", { agent: "claude" });
    reporter.operation("command_run", performance.now(), "success");
    // SDK queues have been populated, but their flush has not run yet.
    await new Promise((resolve) => setImmediate(resolve));
    const before = endpoint.requests.length;
    enabled = false;
    reporter.operation("command_run", performance.now(), "error");
    await reporter.close();
    assert.equal(endpoint.requests.length, before);
    assert.equal(eventBatches(endpoint.requests).length, 0);
  } finally {
    await endpoint.close();
  }
});

test("a saturated or stalled provider cannot block command work or unboundedly delay shutdown", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  const warning = t.mock.method(console, "warn", () => {});
  for (const mode of [true, "body"] as const) {
    const endpoint = await sink(mode);
    try {
      const reporter = new Reporter(endpoint.config);
      const started = performance.now();
      for (let i = 0; i < 10_000; i++)
        reporter.capture("command_completed", { command: "status" });
      assert.ok(
        performance.now() - started < 200,
        "enqueue must not wait for a provider",
      );
      const closing = performance.now();
      await reporter.close();
      assert.ok(
        performance.now() - closing < 1000,
        "shutdown is bounded even when the provider never replies",
      );
      assert.ok(eventBatches(endpoint.requests).length <= 128);
    } finally {
      await endpoint.close();
    }
  }
  assert.equal(
    error.mock.callCount(),
    0,
    "SDK failures must not print private provider responses or paths",
  );
  assert.equal(
    warning.mock.callCount(),
    0,
    "bounded shutdown must remain silent",
  );
});

test("private installation preference resets only telemetry and invalidates running generations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "grove-telemetry-"));
  const env = {
    CI: process.env.CI,
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    GROVE_TELEMETRY: process.env.GROVE_TELEMETRY,
    GROVE_PRIVATE: process.env.GROVE_PRIVATE,
  };
  for (const key of Object.keys(env)) delete process.env[key];
  try {
    await writeFile(
      join(directory, "credentials-user.json"),
      "PRIVATE_CREDENTIAL",
      { mode: 0o600 },
    );
    const first = installationIdentity(directory);
    assert.match(first, /^[a-f0-9-]{36}$/);
    assert.equal(installationIdentity(directory), first);
    assert.equal(
      (await stat(join(directory, "telemetry-id"))).mode & 0o777,
      0o600,
    );
    setTelemetryEnabled(false, directory);
    assert.equal(installationIdentity(directory), "");
    assert.equal(identityAllowed(first, directory), false);
    setTelemetryEnabled(true, directory);
    const next = installationIdentity(directory);
    assert.notEqual(next, first);
    assert.equal(identityAllowed(first, directory), false);
    assert.equal(
      await readFile(join(directory, "credentials-user.json"), "utf8"),
      "PRIVATE_CREDENTIAL",
    );
    for (const [key, value] of [
      ["DO_NOT_TRACK", "1"],
      ["GROVE_TELEMETRY", "0"],
      ["GROVE_PRIVATE", "1"],
      ["CI", "true"],
    ]) {
      process.env[key] = value;
      assert.equal(identityAllowed(next, directory), false);
      delete process.env[key];
    }
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
