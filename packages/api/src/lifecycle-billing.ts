import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { camelRows, type Knex } from "@lib/database";
import { z } from "zod";
import type { JobBroker } from "./broker.ts";

type Binding = { release: string; receipt: string };
export const ordinaryLifecycleBinding = {
  release: "0".repeat(64),
  receipt: "0".repeat(64),
};
type Claim = {
  taskId: string;
  accountId: string;
  leaseId: string;
  generation: string;
  customerId: string;
  accountStatus: string;
};
const id = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_-]+$/);
const subscription = z.object({
  id,
  customer: id,
  status: z.enum([
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ]),
  cancel_at_period_end: z.boolean(),
  items: z.object({
    has_more: z.literal(false).optional(),
    data: z
      .array(
        z.object({
          price: z.object({ id, product: z.union([id, z.object({ id })]) }),
          quantity: z.number().int().nonnegative().nullable().optional(),
          current_period_end: z.number().int().positive().max(253402300799),
        }),
      )
      .min(1)
      .max(100),
  }),
});
const session = z.object({
  id,
  customer: id,
  status: z.enum(["open", "complete", "expired"]),
});
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requestOptions = { timeout: 5000, maxNetworkRetries: 0 };
const qualifiedClients = new WeakSet<Stripe>();
/** Stripe retries ECONNRESET once even with maxNetworkRetries=0. Guard the
 * supported fetch adapter itself, not a private SDK retry method. */
export function createLifecycleStripe(
  secret: string,
  transport: typeof fetch = fetch,
) {
  const effects = new Set<string>();
  const client = new Stripe(secret, {
    timeout: 5000,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(async (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.origin, "https://api.stripe.com");
      if (init?.method !== "GET") {
        assert(
          (init?.method === "DELETE" &&
            /^\/v1\/subscriptions\/[a-zA-Z0-9_-]+$/.test(target.pathname)) ||
            (init?.method === "POST" &&
              /^\/v1\/checkout\/sessions\/[a-zA-Z0-9_-]+\/expire$/.test(
                target.pathname,
              )),
        );
        const key = `${init.method}:${target.pathname}`;
        assert(
          !effects.has(key) && effects.size < 10000,
          "Lifecycle effect transport replay blocked",
        );
        effects.add(key);
      }
      try {
        return await transport(url, { ...init, redirect: "error" });
      } catch {
        throw new Error("Lifecycle provider acceptance unknown");
      }
    }),
  });
  qualifiedClients.add(client);
  return client;
}

/** One durable task, never an effectful module import or an open SQL transaction. */
export async function reconcileLifecycleBilling(
  db: Knex,
  stripe: Stripe,
  binding: Binding = ordinaryLifecycleBinding,
  wanted: string | null = null,
  signal?: AbortSignal,
) {
  assert(
    qualifiedClients.has(stripe),
    "Qualified single-attempt lifecycle transport required",
  );
  const claim = camelRows<Claim>(
    await db.raw("SELECT * FROM grove_lifecycle_claim(?,?,?)", [
      binding.release,
      binding.receipt,
      wanted,
    ]),
  )[0];
  if (!claim) return false;
  const scope = [
    binding.release,
    binding.receipt,
    claim.taskId,
    claim.leaseId,
    claim.accountStatus,
  ];
  const deadline = Date.now() + 50000;
  const preflight = async () => {
    signal?.throwIfAborted();
    assert(Date.now() < deadline, "Lifecycle task deadline");
    const result = await db.raw(
      "SELECT grove_lifecycle_valid(?,?,?,?,?) AS valid",
      scope,
    );
    assert.equal(result.rows[0].valid, true, "Lifecycle work fence");
  };
  async function list<T>(
    read: (after?: string) => Promise<{ data: unknown[]; has_more: boolean }>,
    schema: z.ZodType<T>,
  ) {
    const data: T[] = [],
      seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      await preflight();
      const result = await read(after);
      assert.equal(typeof result.has_more, "boolean");
      assert(Array.isArray(result.data) && result.data.length <= 100);
      const entries = result.data.map((entry) => schema.parse(entry));
      for (const entry of entries) {
        const scoped = entry as { id: string; customer: string };
        assert.equal(
          scoped.customer,
          claim.customerId,
          "Foreign billing tenant",
        );
        assert(!seen.has(scoped.id), "Duplicate provider page");
        seen.add(scoped.id);
      }
      data.push(...entries);
      if (!result.has_more) return data;
      assert(entries.length > 0, "Incomplete provider page");
      after = (entries.at(-1) as { id: string }).id;
    }
    throw new Error("Provider page limit");
  }
  try {
    const read = async () => ({
      subscriptions: await list(
        (starting_after) =>
          stripe.subscriptions.list(
            {
              customer: claim.customerId,
              status: "all",
              limit: 100,
              ...(starting_after ? { starting_after } : {}),
            },
            requestOptions,
          ),
        subscription,
      ),
      sessions: await list(
        (starting_after) =>
          stripe.checkout.sessions.list(
            {
              customer: claim.customerId,
              limit: 100,
              ...(starting_after ? { starting_after } : {}),
            },
            requestOptions,
          ),
        session,
      ),
    });
    let { subscriptions, sessions } = await read();
    if (["deleting", "deleted"].includes(claim.accountStatus)) {
      const terminal = (status: string) =>
        ["canceled", "incomplete_expired"].includes(status);
      const confirmReadback = async () => {
        await preflight();
        const effects = camelRows<{
          operation: "cancel" | "expire";
          remoteId: string | null;
          state: string;
        }>(
          await db.raw(
            "SELECT * FROM grove_lifecycle_effects(?,?,?,?,?)",
            scope,
          ),
        );
        for (const effect of effects) {
          if (effect.state === "confirmed" && effect.remoteId === null)
            continue;
          assert(effect.remoteId, "Unresolved effect identity unavailable");
          const resolved =
            effect.operation === "cancel"
              ? subscriptions.some(
                  (s) => s.id === effect.remoteId && terminal(s.status),
                )
              : sessions.some(
                  (s) => s.id === effect.remoteId && s.status !== "open",
                );
          // An ongoing or missing result does not prove the previous effect
          // wasn't accepted. Never turn it into a second non-idempotent call.
          assert(
            resolved,
            "Uncertain lifecycle effect needs read-only reconciliation",
          );
          if (effect.state !== "confirmed") {
            const result = await db.raw(
              "SELECT grove_lifecycle_effect(?,?,?,?,?,?,?,true) AS confirmed",
              [...scope, effect.operation, effect.remoteId],
            );
            assert.equal(result.rows[0].confirmed, true);
          }
        }
      };
      await confirmReadback();
      let changed = false;
      const effect = async (
        operation: "cancel" | "expire",
        target: string,
        run: () => Promise<unknown>,
      ) => {
        await preflight();
        const reserved = await db.raw(
          "SELECT grove_lifecycle_effect(?,?,?,?,?,?,?,false) AS reserved",
          [...scope, operation, target],
        );
        assert.equal(
          reserved.rows[0].reserved,
          true,
          "Prior effect must be reconciled read-only",
        );
        await preflight();
        await run();
        changed = true;
      };
      for (const s of subscriptions.filter((s) => !terminal(s.status)))
        await effect("cancel", s.id, () =>
          stripe.subscriptions.cancel(s.id, {}, requestOptions),
        );
      for (const s of sessions.filter((s) => s.status === "open"))
        await effect("expire", s.id, () =>
          stripe.checkout.sessions.expire(s.id, {}, requestOptions),
        );
      if (changed) ({ subscriptions, sessions } = await read());
      await confirmReadback();
      assert(
        subscriptions.every((s) => terminal(s.status)) &&
          sessions.every((s) => s.status !== "open"),
        "Deletion reconciliation incomplete",
      );
    }
    await preflight();
    const normalized = subscriptions
      .map((s) => ({
        id: s.id,
        customer: s.customer,
        status: s.status,
        price:
          s.items.data.length === 1 && s.items.data[0]!.quantity === 1
            ? s.items.data[0]!.price.id
            : "unsupported",
        product:
          s.items.data.length === 1 && s.items.data[0]!.quantity === 1
            ? typeof s.items.data[0]!.price.product === "string"
              ? s.items.data[0]!.price.product
              : s.items.data[0]!.price.product.id
            : null,
        periodEnd: s.items.data[0]!.current_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const remoteHash = digest({
      subscriptions: normalized,
      sessions: sessions
        .map((s) => ({ id: s.id, status: s.status }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    const result = await db.raw(
      "SELECT grove_lifecycle_complete(?,?,?,?,?,?,?,?) AS completed",
      [
        ...scope,
        JSON.stringify(normalized),
        remoteHash,
        sessions.filter((s) => s.status === "open").length,
      ],
    );
    assert.equal(result.rows[0].completed, true, "Lifecycle commit fence");
    return true;
  } catch {
    await db.raw("SELECT grove_lifecycle_failure(?,?,?,?)", [
      binding.release,
      binding.receipt,
      claim.taskId,
      claim.leaseId,
    ]);
    return false;
  }
}

export async function publishLifecycleWork(
  db: Knex,
  broker: JobBroker | null | undefined,
  binding = ordinaryLifecycleBinding,
  signal?: AbortSignal,
) {
  if (!broker?.connected || signal?.aborted) return 0;
  const { rows } = await db.raw("SELECT * FROM grove_lifecycle_dispatch(?,?)", [
    binding.release,
    binding.receipt,
  ]);
  let count = 0;
  for (const row of rows) {
    if (signal?.aborted) break;
    let confirmed = false;
    try {
      await broker.publish({ kind: "task", id: row.id }, "bulk");
      confirmed = true;
      count++;
    } finally {
      await db.raw("SELECT grove_dispatch_finish('task',?,?,?)", [
        row.id,
        row.dispatch_id,
        confirmed,
      ]);
    }
  }
  return count;
}
