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
};
if (
  !["read", "search", "mixed", "chat"].includes(config.workload) ||
  config.accounts * config.notes > 100000
)
  throw new Error(
    "Use read/search/mixed/chat and at most 100,000 total fixture notes",
  );
const source = execFileSync("git", ["rev-parse", "HEAD"], {
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
const percentile = (values: number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(
      sorted[
        Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
      ] * 100,
    ) / 100
  );
};
try {
  const queryCounts: Record<string, number> = {};
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
        arguments: { query: "garden" },
      });
      if (result.isError) throw new Error("MCP recall fixture failed");
    });
  } finally {
    await mcp.close();
  }
  // Remove only this fixture's preflight admission counters before the measured window.
  await fixture.admin("rate_buckets").delete();
  const conversations = await Promise.all(
    fixture.principals.map((_, account) =>
      request("/v1/conversations", account, {
        id: randomUUID(),
        includePersonal: true,
      }),
    ),
  );
  const versions = conversations.map(() => 0);
  const active = new Set<Promise<void>>();
  const timings: number[] = [],
    scheduleTimings: number[] = [];
  const statuses: Record<string, number> = {};
  let dropped = 0,
    queries = 0,
    rssPeak = process.memoryUsage().rss,
    poolWaitingPeak = 0,
    poolUsedPeak = 0;
  const onQuery = () => queries++;
  fixture.db.on("query", onQuery);
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
      try {
        const result =
          config.workload === "chat"
            ? await request(
                `/v1/conversations/${conversations[account].data.data.id}/turns`,
                account,
                {
                  id: randomUUID(),
                  query: "Find garden notes",
                  expectedVersion: versions[account]++,
                  format: "plain",
                },
              )
            : config.workload === "mixed" && index % 20 === 19
              ? await request("/v1/memories", account, {
                  operationId: randomUUID(),
                  content: `Capacity save ${index}: garden observations.`,
                  kind: "fact",
                })
              : await request("/v1/memories/search", account, {
                  limit: 30,
                  ...(config.workload === "search" ||
                  (config.workload === "mixed" && index % 5 === 4)
                    ? { query: "garden" }
                    : {}),
                });
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      } catch {
        statuses.transport_error = (statuses.transport_error ?? 0) + 1;
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
  eventLoop.disable();
  fixture.db.off("query", onQuery);
  const queue = await fixture.admin("jobs").count("id as count").first();
  const report = {
    source,
    node: process.version,
    config,
    conditions: {
      database: "disposable PostgreSQL/pgvector with non-owner API role",
      authentication:
        "real Authentication/database path; synthetic token verifier",
      providers: "deterministic in-process delay fixtures",
      resources:
        "API and load generator share a process; DB sizing supplied by operator",
      worker:
        "not running; mixed writes report queued work, not sustainable processing",
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
    sqlQueries: queries,
    sqlPerRequest: queries / Math.max(1, timings.length),
    poolUsedPeak,
    poolWaitingPeak,
    rssPeakBytes: rssPeak,
    cpuMilliseconds: (cpu.user + cpu.system) / 1000,
    eventLoopP95Ms: eventLoop.percentile(95) / 1e6,
    queuedJobs: Number(queue?.count ?? 0),
  };
  const json = JSON.stringify(report, null, 2);
  if (values.output) await writeFile(values.output, `${json}\n`);
  console.log(json);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await fixture.close();
}
