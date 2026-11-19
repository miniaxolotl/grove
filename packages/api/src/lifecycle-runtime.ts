import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getRequestListener } from "@hono/node-server";
import { createDatabase, probeDatabase, type Knex } from "@lib/database";
import type Stripe from "stripe";
import { serveHeldStatus, type HoldIdentity } from "./release-hold.ts";
import { createLifecycleIngress } from "./lifecycle-ingress.ts";
import {
  createLifecycleStripe,
  reconcileLifecycleBilling,
} from "./lifecycle-billing.ts";
import { JobBroker } from "./broker.ts";

const releaseHash = (identity: HoldIdentity) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(identity)
            .sort()
            .map((key) => [key, identity[key as keyof HoldIdentity]]),
        ),
      ),
    )
    .digest("hex");
function database(role: "api" | "worker", env: NodeJS.ProcessEnv) {
  const url = new URL(env.DATABASE_URL ?? "");
  assert(["postgres:", "postgresql:"].includes(url.protocol));
  assert.equal(url.username, role === "api" ? "grove_api" : "grove_jobs");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(env.DATABASE_SSL, "require");
  return createDatabase(url.href, {
    ssl: true,
    max: 4,
    acquireTimeoutMs: 10000,
    statementTimeoutMs: 10000,
  });
}

/** A bare environment hash is never release authority. Owner-only handoff and
 * the final generation/evidence fence commit before importing general runtime. */
export async function approveLifecycleRuntime(
  identity: HoldIdentity,
  approval: string,
  role: "api" | "worker",
  env: NodeJS.ProcessEnv,
) {
  let db: Knex | undefined;
  try {
    db = database(role, env);
    await probeDatabase(db);
    const result = await db.raw(
      "SELECT grove_lifecycle_release_approved(?,?) AS admitted",
      [releaseHash(identity), approval],
    );
    assert.equal(result.rows[0].admitted, true);
  } catch {
    throw new Error(
      "Persisted release approval unavailable; runtime effects remain stopped",
    );
  } finally {
    await db?.destroy();
  }
}

/** Isolated from runtime.ts / worker-runtime.ts: no general worker, mail,
 * models, storage clients, sweepers, schedulers or flags client is imported. */
export async function startLifecycleRuntime(
  identity: HoldIdentity,
  receipt: string,
  role: "api" | "worker",
  env: NodeJS.ProcessEnv,
  fixture: { database?: Knex; stripe?: Stripe } = {},
) {
  const db = fixture.database ?? database(role, env),
    owned = !fixture.database;
  const binding = { release: releaseHash(identity), receipt };
  const bound = async () => {
    await probeDatabase(db);
    const result = await db.raw("SELECT grove_lifecycle_bound(?,?) AS bound", [
      binding.release,
      receipt,
    ]);
    assert.equal(
      result.rows[0].bound,
      true,
      "Lifecycle phase admission unavailable",
    );
  };
  let http: Awaited<ReturnType<typeof serveHeldStatus>> | undefined;
  let broker: JobBroker | undefined;
  const abort = new AbortController();
  let done = Promise.resolve(),
    closing = false,
    busy = false;
  try {
    await bound();
    assert.match(env.STRIPE_SECRET_KEY ?? "", /^(sk|rk)_(live|test)_/);
    const stripe =
      fixture.stripe ?? createLifecycleStripe(env.STRIPE_SECRET_KEY!);
    if (role === "api") {
      assert(env.CLERK_WEBHOOK_SIGNING_SECRET && env.STRIPE_WEBHOOK_SECRET);
      const ingress = createLifecycleIngress({
        clerkSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
        stripeSecret: env.STRIPE_WEBHOOK_SECRET,
        stripe,
        livemode: /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY!),
        accept: async (event) => {
          await db.raw("SELECT grove_lifecycle_accept(?,?,?,?,?,?,?,?,?)", [
            binding.release,
            receipt,
            event.provider,
            event.id,
            event.fingerprint,
            event.type,
            event.subject,
            event.eventAt,
            event.disabled,
          ]);
        },
      });
      http = await serveHeldStatus(
        identity,
        role,
        env,
        bound,
        getRequestListener((request) => ingress(request)),
      );
    } else {
      assert(env.AMQP_URL, "Existing broker configuration required");
      const run = async (wanted: string | null = null) => {
        if (closing || busy) return;
        busy = true;
        try {
          await reconcileLifecycleBilling(db, stripe, binding, wanted);
        } finally {
          busy = false;
        }
      };
      broker = new JobBroker(
        env.AMQP_URL,
        { bulk: 1 },
        async (job) => {
          if (job.kind === "task") await run(job.id);
        },
        false,
      );
      const queue = broker;
      http = await serveHeldStatus(identity, role, env, bound);
      done = (async () => {
        while (!closing) {
          try {
            // PostgreSQL is authoritative during broker outages or lost
            // confirmations. No payload other than opaque task IDs is queued.
            await db.raw("SELECT grove_lifecycle_enroll(?,?)", [
              binding.release,
              receipt,
            ]);
            await run();
            if (!queue.connected) await queue.connect().catch(() => {});
            if (!closing && queue.connected) {
              const { rows } = await db.raw(
                "SELECT * FROM grove_lifecycle_dispatch(?,?)",
                [binding.release, receipt],
              );
              for (const row of rows) {
                if (closing) break;
                let confirmed = false;
                try {
                  await queue.publish({ kind: "task", id: row.id }, "bulk");
                  confirmed = true;
                } catch {
                  /* Durable redispatch below. */
                }
                await db.raw("SELECT grove_dispatch_finish('task',?,?,?)", [
                  row.id,
                  row.dispatch_id,
                  confirmed,
                ]);
              }
            }
          } catch {
            /* Retain durable pending/failed/uncertain state, never fake completion. */
          }
          await delay(1000, undefined, { signal: abort.signal }).catch(
            () => {},
          );
        }
      })();
    }
    const server = http.server;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      void close();
    };
    const close = () =>
      (stopping ??= (async () => {
        closing = true;
        abort.abort();
        process.removeListener("SIGTERM", stop);
        process.removeListener("SIGINT", stop);
        // A connect already in flight may install its socket/channels after a
        // premature close. Drain the bounded loop first, then close the broker.
        await done;
        await broker?.close();
        await http!.close();
        if (owned) await db.destroy();
      })());
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    return { server, close };
  } catch {
    closing = true;
    abort.abort();
    await done;
    await broker?.close();
    await http?.close();
    if (owned) await db.destroy();
    throw new Error(
      "Lifecycle-only startup unavailable; general runtime remains held",
    );
  }
}
