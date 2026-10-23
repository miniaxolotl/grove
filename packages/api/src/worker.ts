import { createClerkClient } from "@clerk/backend";
import { setTimeout } from "node:timers/promises";
import { createRuntime } from "./runtime.ts";
import { camelRows } from "@lib/database";
import { deliverEmail } from "./mail.ts";
import { JobBroker, type JobEnvelope } from "./broker.ts";
import { WorkerPool } from "./worker-pool.ts";
import { closeTelemetry, telemetry } from "@lib/telemetry";
import { withTelemetry } from "@lib/telemetry/context";
import {
  cleanupHandlers,
  exportHandlers,
  importHandlers,
  scheduleCleanup,
  runTask,
  providerProfiles,
  speechHandlers,
  type TaskHandler,
} from "@lib/memory";
import { queueLanes, type QueueLane, type TaskKind } from "@lib/shared/jobs";
import { readMediaBytes } from "./media-input.ts";

const runtime = await createRuntime();
const reporter = telemetry("worker");
const clerk = createClerkClient({ secretKey: runtime.env.CLERK_SECRET_KEY });
const controller = new AbortController();
const workStop = new AbortController();
const stop = () => {
  controller.abort();
  globalThis.setTimeout(() => workStop.abort(), 25000).unref();
  globalThis
    .setTimeout(() => {
      console.error(JSON.stringify({ code: "shutdown_lease_recovery" }));
      process.exit(1);
    }, 35000)
    .unref();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const mail = runtime.env.RESEND_API_KEY
  ? {
      key: runtime.env.RESEND_API_KEY,
      from: runtime.env.EMAIL_FROM,
      siteUrl: runtime.env.SITE_URL,
    }
  : null;
const recipient = async (subject: string) => {
  const user = await clerk.users.getUser(subject);
  return (
    user.emailAddresses.find(
      (address) =>
        address.id === user.primaryEmailAddressId &&
        address.verification?.status === "verified",
    )?.emailAddress ?? null
  );
};
const handlers: Partial<Record<TaskKind, TaskHandler>> = {
  ...speechHandlers(
    runtime.memories,
    runtime.speech,
    runtime.artifacts,
    runtime.media
      ? (key, signal) =>
          runtime
            .media!.read(key, signal)
            .then((source) => readMediaBytes(source, signal))
      : null,
    runtime.db,
    runtime.env.SPEECH_PROVIDER_CONCURRENCY,
  ),
  ...(runtime.artifacts
    ? exportHandlers(runtime.db, runtime.artifacts, runtime.media)
    : {}),
  ...importHandlers(runtime.memories),
  ...cleanupHandlers(runtime.db, async (subject) => {
    try {
      await clerk.users.deleteUser(subject);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }),
  model_backfill: async (task) => {
    await runtime.db.raw("SELECT grove_backfill_batch(?::uuid,?::uuid,100)", [
      task.id,
      task.leaseId,
    ]);
  },
};
const capacities: Record<QueueLane, number> = {
  indexing: runtime.env.INDEXING_CONCURRENCY,
  enrichment: runtime.env.AI_CONCURRENCY,
  email: mail ? runtime.env.EMAIL_CONCURRENCY : 0,
  maintenance: runtime.env.MAINTENANCE_CONCURRENCY,
  bulk: runtime.env.BULK_CONCURRENCY,
};
for (const lane of queueLanes)
  if (!runtime.env.WORKER_LANES.split(",").includes(lane)) capacities[lane] = 0;
const pools = Object.fromEntries(
  queueLanes.map((lane) => [lane, new WorkerPool(capacities[lane])]),
) as Record<QueueLane, WorkerPool>;
const execute = (lane: QueueLane, id?: string) =>
  withTelemetry(reporter, async () => {
    if (lane === "email")
      return mail ? deliverEmail(runtime.db, mail, recipient, id) : false;
    if (lane === "indexing" || lane === "enrichment")
      return runtime.memories.runJob(id, {
        lane,
        accountLimit: runtime.env.JOB_ACCOUNT_CONCURRENCY,
        providerLimit: runtime.env.JOB_PROVIDER_CONCURRENCY,
        signal: workStop.signal,
      });
    return runTask(runtime.db, handlers, {
      id,
      lane,
      accountLimit: 1,
      signal: workStop.signal,
    });
  });
const run = async (job: JobEnvelope, lane?: QueueLane) => {
  if (controller.signal.aborted) return;
  if (!lane) {
    // Legacy deliveries are drained through the same capacity gates. A rejected
    // lane is redispatched from PostgreSQL to its current queue.
    if (job.kind === "email") lane = "email";
    else {
      for (const candidate of ["indexing", "enrichment"] as const)
        if (await pools[candidate].run(() => execute(candidate, job.id)))
          return;
      return;
    }
  }
  await pools[lane].run(() => execute(lane!, job.id));
};
const broker = runtime.env.AMQP_URL
  ? new JobBroker(
      runtime.env.AMQP_URL,
      capacities,
      run,
      runtime.env.WORKER_LEGACY_QUEUE,
    )
  : null;
const pause = (ms: number) =>
  setTimeout(ms, undefined, { signal: controller.signal });
const loop = async (code: string, work: () => Promise<number>) => {
  while (!controller.signal.aborted) {
    try {
      await pause(await work());
    } catch {
      if (!controller.signal.aborted) {
        console.error(JSON.stringify({ code }));
        await pause(1000 + Math.random() * 1000).catch(() => {});
      }
    }
  }
};
let reconnectAt = 0;
const dispatch = loop("dispatch_retry", async () => {
  if (!broker) return 1000;
  if (!broker.connected) {
    if (Date.now() < reconnectAt) return 1000;
    try {
      await broker.connect();
      console.info(JSON.stringify({ code: "broker_connected" }));
    } catch {
      reconnectAt = Date.now() + 30000;
      throw new Error("broker_retry");
    }
  }
  let count = 0;
  try {
    for (const lane of queueLanes.filter((lane) => capacities[lane] > 0)) {
      const source =
        lane === "email"
          ? "email"
          : lane === "bulk" || lane === "maintenance"
            ? "task"
            : "memory";
      const jobs = camelRows<JobEnvelope & { dispatchId: string }>(
        await runtime.db.raw(
          "SELECT * FROM grove_dispatch_claim(?,?,?::text[],?)",
          [source, lane, providerProfiles(runtime.memories.providers), 32],
        ),
      );
      for (let offset = 0; offset < jobs.length; offset += 4) {
        const outcomes = await Promise.allSettled(
          jobs.slice(offset, offset + 4).map(async (job) => {
            let confirmed = false;
            try {
              await broker.publish({ id: job.id, kind: job.kind }, lane);
              confirmed = true;
            } finally {
              await runtime.db.raw(
                "SELECT grove_dispatch_finish(?,?::uuid,?::uuid,?)",
                [job.kind, job.id, job.dispatchId, confirmed],
              );
            }
          }),
        );
        if (outcomes.some((result) => result.status === "rejected"))
          throw new Error("broker_retry");
      }
      count += jobs.length;
    }
  } catch (error) {
    await broker.disconnect();
    reconnectAt = Date.now() + 30000;
    throw error;
  }
  return count ? 50 : 500 + Math.random() * 250;
});
const consumers = queueLanes.flatMap((lane) =>
  Array.from({ length: capacities[lane] }, () =>
    loop("worker_retry", async () => {
      if (broker?.connected) return 500;
      const processed = await pools[lane].run(() => execute(lane));
      return processed ? 10 : 500 + Math.random() * 500;
    }),
  ),
);
const models = loop("models_retry", async () => {
  await runtime.models.refresh();
  return 5000;
});
const maintenance = loop("maintenance_retry", async () => {
  const started = performance.now();
  await runtime.db.raw("SELECT grove_sweep_deliveries()");
  await scheduleCleanup(runtime.db);
  await runtime.db.raw("SELECT grove_expire_speech()");
  if (runtime.artifacts)
    await runtime.db.raw("SELECT grove_schedule_artifacts()");
  await runtime.memories.scheduleOrganization(
    runtime.env.ORGANIZATION_INTERVAL_SECONDS,
  );
  reporter.operation("maintenance", started, "success");
  console.info(
    JSON.stringify({
      code: "queue_status",
      queues: camelRows(
        await runtime.db.raw("SELECT * FROM grove_queue_stats()"),
      ),
    }),
  );
  return 60000;
});
try {
  await Promise.all([dispatch, ...consumers, models, maintenance]);
} finally {
  await broker?.close();
  await Promise.all(Object.values(pools).map((pool) => pool.drain()));
  await runtime.close();
  await closeTelemetry();
}
