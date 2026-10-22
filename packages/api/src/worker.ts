import { createClerkClient } from "@clerk/backend";
import { setTimeout } from "node:timers/promises";
import { createRuntime } from "./runtime.ts";
import { camelRows, tenant } from "@lib/database";
import { deliverEmail } from "./mail.ts";
import { JobBroker, type JobEnvelope } from "./broker.ts";
import { closeTelemetry, telemetry } from "@lib/telemetry";
import { withTelemetry } from "@lib/telemetry/context";
import { providerProfiles } from "@lib/memory";

const runtime = await createRuntime();
const reporter = telemetry("worker");
const clerk = createClerkClient({ secretKey: runtime.env.CLERK_SECRET_KEY });
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
let maintenanceAt = 0;
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
const run = async (job: JobEnvelope) => {
  if (job.kind === "memory")
    await withTelemetry(reporter, () => runtime.memories.runJob(job.id));
  else if (mail) await deliverEmail(runtime.db, mail, recipient, job.id);
};
const broker = runtime.env.AMQP_URL
  ? new JobBroker(runtime.env.AMQP_URL, runtime.env.AI_CONCURRENCY, run)
  : null;
let reconnectAt = 0;
try {
  while (!controller.signal.aborted) {
    const iterationStarted = performance.now();
    try {
      await runtime.models.refresh();
      if (Date.now() > maintenanceAt) {
        const started = performance.now();
        await runtime.db.raw("SELECT grove_sweep_deliveries()");
        await runtime.memories.maintenance(async (subject) => {
          try {
            await clerk.users.deleteUser(subject);
          } catch (error) {
            if ((error as { status?: number }).status !== 404) throw error;
          }
        });
        maintenanceAt = Date.now() + 60000;
        const scheduled = await runtime.memories.scheduleOrganization(
          runtime.env.ORGANIZATION_INTERVAL_SECONDS,
        );
        reporter.operation("maintenance", started, "success");
        if (scheduled.accounts)
          console.info(
            JSON.stringify({ code: "organization_scheduled", ...scheduled }),
          );
      }
      if (broker && !broker.connected && Date.now() >= reconnectAt) {
        try {
          await broker.connect();
          console.info(JSON.stringify({ code: "broker_connected" }));
        } catch {
          reconnectAt = Date.now() + 30000;
          console.error(JSON.stringify({ code: "broker_retry" }));
        }
      }
      if (broker?.connected) {
        const profiles = providerProfiles(runtime.memories.providers);
        const jobs = camelRows<
          JobEnvelope & { queueKind: JobEnvelope["kind"]; accountId: string }
        >(
          await runtime.db.raw(
            "SELECT * FROM grove_due_dispatch(?::text[], ?)",
            [profiles, !!mail],
          ),
        );
        for (const job of jobs) {
          await broker.publish({ kind: job.queueKind, id: job.id });
          await tenant(runtime.db, job.accountId, (trx) =>
            trx(job.queueKind === "memory" ? "jobs" : "transactional_emails")
              .where({ id: job.id })
              .update({ dispatchedAt: trx.fn.now() }),
          );
        }
        await setTimeout(2000, undefined, { signal: controller.signal });
        continue;
      }
      const work = await Promise.all(
        Array.from({ length: runtime.env.AI_CONCURRENCY }, () =>
          withTelemetry(reporter, () => runtime.memories.runJob()),
        ),
      );
      if (mail) work.push(await deliverEmail(runtime.db, mail, recipient));
      if (!work.some(Boolean))
        await setTimeout(1000, undefined, { signal: controller.signal });
    } catch (error) {
      if (!controller.signal.aborted) {
        reporter.operation("job_run", iterationStarted, "error", {}, error);
        console.error(JSON.stringify({ code: "worker_retry" }));
        await setTimeout(5000, undefined, { signal: controller.signal }).catch(
          () => {},
        );
      }
    }
  }
} finally {
  await broker?.close();
  await runtime.close();
  await closeTelemetry();
}
