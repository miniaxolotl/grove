import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { capacityFixture } from "../fixtures/capacity.ts";
import type { Knex } from "@lib/database";
import { observeDatabase, percentile } from "./metrics.ts";

const { values } = parseArgs({
  options: {
    accounts: { type: "string", default: "20" },
    notes: { type: "string", default: "100" },
    seconds: { type: "string", default: "30" },
    rate: { type: "string", default: "10" },
    concurrency: { type: "string", default: "64" },
    pool: { type: "string", default: "8" },
    embedding: { type: "string", default: "100" },
    generation: { type: "string", default: "500" },
    workload: { type: "string", default: "read" },
    output: { type: "string" },
    query: { type: "string", default: "garden" },
    "query-seed": { type: "string", default: "1" },
    worker: { type: "string", default: "0" },
    "provider-failure-every": { type: "string", default: "0" },
    explain: { type: "boolean", default: false },
  },
});
const integer = (name: keyof typeof values, min: number, max: number) => {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid --${name}`);
  return value;
};
const config = {
  accounts: integer("accounts", 1, 500),
  notes: integer("notes", 1, 10000),
  seconds: integer("seconds", 1, 3600),
  rate: integer("rate", 1, 1000),
  concurrency: integer("concurrency", 1, 1000),
  pool: integer("pool", 1, 64),
  embeddingDelayMs: integer("embedding", 0, 10000),
  generationDelayMs: integer("generation", 0, 60000),
  workload: values.workload,
  query: values.query,
  querySeed: integer("query-seed", 1, 100000),
  workerConcurrency: integer("worker", 0, 32),
  providerFailureEvery: integer("provider-failure-every", 0, 10000),
};
if (
  !["read", "search", "recall", "mixed", "chat"].includes(config.workload) ||
  config.accounts * config.notes > 100000
)
  throw new Error(
    "Use read/search/recall/mixed/chat and at most 100,000 total fixture notes",
  );
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
console.error(
  `Preparing ${config.accounts} accounts × ${config.notes} notes; ${config.workload} at ${config.rate}/s`,
);
const fixture = await capacityFixture(config);
const server = serve({
  fetch: fixture.app.fetch,
  hostname: "127.0.0.1",
  port: 0,
});
if (!server.listening)
  await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Missing fixture port");
const origin = `http://127.0.0.1:${address.port}`;
const request = async (path: string, account = 0, body?: object) => {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${account}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  return { status: response.status, data };
};
const countQueries = async (run: () => Promise<unknown>) => {
  let queries = 0;
  const onQuery = () => queries++;
  fixture.db.on("query", onQuery);
  try {
    await run();
  } finally {
    fixture.db.off("query", onQuery);
  }
  return queries;
};
let workerStopped = false;
let workerRun: Promise<void> | undefined;
try {
  const queryCounts: Record<string, number> = {};
  const plans: unknown[] = [];
  const explainQueries = new Map<
    string,
    { sql: string; bindings: Knex.RawBinding[] }
  >();
  const capturePlan = (query: { sql: string; bindings: Knex.RawBinding[] }) => {
    if (
      values.explain &&
      query.sql.startsWith("select") &&
      query.sql.includes("<=>")
    )
      explainQueries.set(query.sql, query);
  };
  fixture.db.on("query", capturePlan);
  for (const limit of [1, 30, 100]) {
    queryCounts[`list_${limit}`] = await countQueries(async () => {
      const response = await request("/v1/memories/search", 0, { limit });
      if (response.status !== 200) throw new Error("List fixture failed");
    });
  }
  const mcp = new Client({ name: "capacity-fixture", version: "1.0.0" });
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: "Bearer 0" } },
      }),
    );
    queryCounts.mcp_recall = await countQueries(async () => {
      const result = await mcp.callTool({
        name: "recall",
        arguments: { query: config.query },
      });
      if (result.isError) throw new Error("MCP recall fixture failed");
    });
  } finally {
    await mcp.close();
  }
  fixture.db.off("query", capturePlan);
  for (const query of explainQueries.values()) {
    const bindings: Knex.RawBinding[] = [];
    const sql = query.sql.replace(/\$(\d+)/g, (_match, index: string) => {
      bindings.push(query.bindings[Number(index) - 1]);
      return "?";
    });
    plans.push(
      await fixture.service.access(
        fixture.principals[0],
        "memory:read",
        async ({ trx }) =>
          (
            await trx.raw(
              `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
              bindings,
            )
          ).rows[0]["QUERY PLAN"],
      ),
    );
  }
  const conversations = [];
  if (config.workload === "chat") {
    for (let account = 0; account < config.accounts; account++) {
      const conversation = await request("/v1/conversations", account, {
        id: randomUUID(),
        includePersonal: true,
      });
      if (conversation.status !== 200 && conversation.status !== 201)
        throw new Error("Conversation fixture failed");
      conversations.push(conversation);
    }
  }
  // Remove only this fixture's preflight admission counters before the measured window.
  await fixture.admin("rate_buckets").delete();
  fixture.providerMetrics.calls =
    fixture.providerMetrics.peak =
    fixture.providerMetrics.failures =
      0;
  const versions = conversations.map(() => 0);
  const active = new Set<Promise<void>>();
  const timings: number[] = [],
    scheduleTimings: number[] = [];
  const statuses: Record<string, number> = {};
  const operations: Record<
    string,
    { timings: number[]; statuses: Record<string, number> }
  > = {};
  const searchModes: Record<string, number> = {};
  let dropped = 0,
    rssPeak = process.memoryUsage().rss,
    poolWaitingPeak = 0,
    poolUsedPeak = 0;
  const stopDatabase = observeDatabase(fixture.db);
  const stopWorkerDatabase = observeDatabase(fixture.workerDb);
  let servicedJobs = 0;
  if (config.workerConcurrency)
    workerRun = (async () => {
      // Exercise the shipped PostgreSQL fallback batch loop, without maintenance of unrelated resources.
      while (!workerStopped) {
        const work = await Promise.all(
          Array.from({ length: config.workerConcurrency }, () =>
            fixture.worker.runJob(),
          ),
        );
        servicedJobs += work.filter(Boolean).length;
        if (!work.some(Boolean)) await setTimeout(1000);
      }
    })();
  let lockWaitPeak = 0,
    queuedJobsPeak = 0,
    samplePending: Promise<void> | undefined;
  const dbSampling = setInterval(() => {
    if (samplePending) return;
    samplePending = (async () => {
      const result = await fixture.admin.raw(`SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS locks,
        (SELECT count(*) FROM jobs) AS jobs`);
      lockWaitPeak = Math.max(lockWaitPeak, Number(result.rows[0].locks));
      queuedJobsPeak = Math.max(queuedJobsPeak, Number(result.rows[0].jobs));
    })().finally(() => {
      samplePending = undefined;
    });
  }, 500);
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const sampling = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    poolWaitingPeak = Math.max(
      poolWaitingPeak,
      fixture.db.client.pool.numPendingAcquires(),
    );
    poolUsedPeak = Math.max(poolUsedPeak, fixture.db.client.pool.numUsed());
  }, 25);
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  const total = config.rate * config.seconds;
  for (let index = 0; index < total; index++) {
    const scheduled = started + (index * 1000) / config.rate;
    const delay = scheduled - performance.now();
    if (delay > 0) await setTimeout(delay);
    if (active.size >= config.concurrency) {
      dropped++;
      continue;
    }
    const account = index % config.accounts;
    const task = (async () => {
      const sent = performance.now();
      const kind =
        config.workload === "mixed"
          ? index % 20 === 19
            ? "save"
            : index % 20 >= 15
              ? "search"
              : "read"
          : config.workload;
      const operation = (operations[kind] ??= { timings: [], statuses: {} });
      try {
        const result =
          config.workload === "chat"
            ? await request(
                `/v1/conversations/${conversations[account].data.data.id}/turns`,
                account,
                {
                  id: randomUUID(),
                  query: "Find garden notes",
                  expectedVersion: versions[account],
                  format: "plain",
                },
              )
            : kind === "recall"
              ? await request("/v1/recall", account, {
                  query: config.query,
                  includePersonal: true,
                })
              : kind === "save"
                ? await request("/v1/memories", account, {
                    operationId: randomUUID(),
                    content: `Capacity save ${index}: garden observations.`,
                    kind: "fact",
                  })
                : await request("/v1/memories/search", account, {
                    limit: 30,
                    ...(config.workload === "search" || kind === "search"
                      ? { query: config.query }
                      : {}),
                  });
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
        operation.statuses[result.status] =
          (operation.statuses[result.status] ?? 0) + 1;
        if (result.status < 400)
          operation.timings.push(performance.now() - sent);
        if (kind === "chat" && result.status === 200)
          versions[account] = result.data.data.version;
        const mode = result.data.data?.searchMode ?? result.data.data?.mode;
        if (mode) searchModes[mode] = (searchModes[mode] ?? 0) + 1;
      } catch {
        statuses.transport_error = (statuses.transport_error ?? 0) + 1;
        operation.statuses.transport_error =
          (operation.statuses.transport_error ?? 0) + 1;
      }
      timings.push(performance.now() - sent);
      scheduleTimings.push(performance.now() - scheduled);
    })();
    active.add(task);
    void task.finally(() => active.delete(task));
  }
  await Promise.all(active);
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  clearInterval(sampling);
  clearInterval(dbSampling);
  await samplePending;
  eventLoop.disable();
  const database = stopDatabase();
  workerStopped = true;
  await workerRun;
  const workerDatabase = stopWorkerDatabase();
  const queue = await fixture.admin("jobs").count("id as count").first();
  const failedJobs = await fixture
    .admin("jobs")
    .whereNotNull("failedAt")
    .count("id as count")
    .first();
  const report = {
    source,
    dirty,
    node: process.version,
    config,
    conditions: {
      database: "disposable PostgreSQL/pgvector with non-owner API role",
      authentication:
        "real Authentication/database path; synthetic token verifier",
      providers: "deterministic in-process delay fixtures",
      resources:
        "API and load generator share a process; DB sizing supplied by operator",
      worker: config.workerConcurrency
        ? "shipped PostgreSQL fallback loop; synthetic provider outputs, no broker/maintenance"
        : "not running; mixed writes report queued work, not sustainable processing",
    },
    queryCounts,
    offered: total,
    completed: timings.length,
    dropped,
    statuses,
    completedPerSecond: timings.length / (elapsedMs / 1000),
    elapsedMs,
    latencyMs: {
      p50: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      p99: percentile(timings, 0.99),
    },
    scheduledLatencyMs: {
      p95: percentile(scheduleTimings, 0.95),
      p99: percentile(scheduleTimings, 0.99),
    },
    sqlQueries: database.queries,
    sqlPerRequest: database.queries / Math.max(1, timings.length),
    database,
    workerDatabase,
    lockWaitPeak,
    plans,
    searchModes,
    operations: Object.fromEntries(
      Object.entries(operations).map(([kind, operation]) => [
        kind,
        {
          statuses: operation.statuses,
          successfulP95Ms: percentile(operation.timings, 0.95),
        },
      ]),
    ),
    poolUsedPeak,
    poolWaitingPeak,
    rssPeakBytes: rssPeak,
    cpuMilliseconds: (cpu.user + cpu.system) / 1000,
    eventLoopP95Ms: eventLoop.percentile(95) / 1e6,
    queuedJobs: Number(queue?.count ?? 0),
    queuedJobsPeak,
    failedJobs: Number(failedJobs?.count ?? 0),
    servicedJobs,
    providers: fixture.providerMetrics,
  };
  const json = JSON.stringify(
    report,
    (_key, value) =>
      typeof value === "string" && value.length > 500
        ? `${value.slice(0, 140)} … [${value.length} characters]`
        : value,
    2,
  );
  if (values.output) await writeFile(values.output, `${json}\n`);
  console.log(json);
} finally {
  workerStopped = true;
  await workerRun;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await fixture.close();
}
