import {
  tenant,
  withDatabaseSignal,
  databaseSignal,
  type Knex,
} from "@lib/database";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { policy as legacyPolicy } from "@lib/config";
import { GroveError } from "@lib/shared/contracts";
import {
  billingLimits,
  resourceLimits,
  type ActionMetric,
  type ResourceLimits,
  type ResourceUsage,
  type BillingMetric,
  type BillingUsage,
  type PlanLimits,
  type AccountPlan,
} from "@lib/shared/billing";

type Configuration = {
  enabled: (subject: string) => Promise<boolean>;
  priceIds: string[];
  productId?: string;
  limits?: Record<"free" | "pro", PlanLimits>;
  resourceLimits?: Record<"free" | "pro", ResourceLimits>;
};
// Each explicitly configured runtime owns its policy; tests and self-hosted installs
// cannot accidentally inherit another database's cloud policy.
const configurations = new WeakMap<Knex, Configuration>();
export function configureBillingQuotas(db: Knex, configuration: Configuration) {
  configurations.set(db, configuration);
}
export function inheritBillingQuotas(db: Knex, target: Knex) {
  const config = configurations.get(db);
  if (config) configurations.set(target, config);
}
export async function billingEntitlement(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
): Promise<AccountPlan | null> {
  const config = configurations.get(db);
  if (!config) return null;
  const account = await trx("accounts")
    .where({ id: accountId })
    .first("clerkSubject");
  if (!account) return null;
  const grant = await trx("account_administration")
    .where({ accountId })
    .first("access");
  const override =
    grant?.access === "pro" || grant?.access === "unlimited"
      ? (grant.access as "pro" | "unlimited")
      : null;
  if (!override && !(await config.enabled(account.clerkSubject))) return null;
  if (override) return { tier: override, source: "complimentary" };
  const paid = await trx("billing_subscriptions")
    .where({ accountId })
    .whereIn("status", ["active", "trialing"])
    .where((query) => {
      query.whereIn("priceId", config.priceIds);
      if (config.productId) query.orWhere({ productId: config.productId });
    })
    .where("periodEnd", ">", trx.fn.now())
    .orderBy("status", "asc")
    .first("status");
  return paid
    ? { tier: "pro", source: paid.status === "trialing" ? "trial" : "paid" }
    : { tier: "free", source: "free" };
}
export async function billingPlan(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
): Promise<AccountPlan["tier"] | null> {
  return (await billingEntitlement(db, trx, accountId))?.tier ?? null;
}
export async function billingUsage(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
): Promise<BillingUsage | null> {
  const plan = await billingPlan(db, trx, accountId);
  if (!plan) return null;
  const config = configurations.get(db)!;
  const limits = (config.limits ?? billingLimits)[
    plan === "unlimited" ? "pro" : plan
  ];
  const {
    rows: [clock],
  } = await trx.raw(`SELECT
    (now() AT TIME ZONE 'UTC')::date::text AS today,
    date_trunc('month',now() AT TIME ZONE 'UTC')::date::text AS month,
    (date_trunc('day',now() AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC' AS daily,
    (date_trunc('month',now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC' AS monthly`);
  const metrics = {} as BillingUsage["metrics"];
  for (const metric of Object.keys(limits) as BillingMetric[]) {
    const table =
      metric === "generation"
        ? "inference_usage"
        : metric === "research"
          ? "research_account_usage"
          : "speech_usage";
    const units =
      metric === "generation"
        ? "requests"
        : metric === "research"
          ? "calls"
          : metric === "synthesis"
            ? "durationMs"
            : "units";
    const query = trx(table)
      .where({ accountId })
      .whereBetween("day", [clock.month, clock.today]);
    if (metric === "generation") query.where({ role: "generation" });
    if (metric === "transcription" || metric === "synthesis")
      query.where({
        kind:
          metric === "transcription"
            ? "speech_transcribe"
            : "speech_synthesize",
      });
    const usage = await query
      .select(
        trx.raw(
          "COALESCE(SUM(??),0) AS month, COALESCE(SUM(??) FILTER(WHERE day=?::date),0) AS today",
          [units, units, clock.today],
        ),
      )
      .first();
    metrics[metric] = {
      today: Number(usage.today),
      month: Number(usage.month),
      dailyLimit: plan === "unlimited" ? null : limits[metric].daily,
      monthlyLimit: plan === "unlimited" ? null : limits[metric].monthly,
    };
  }
  return {
    plan,
    dailyResetAt: new Date(clock.daily).toISOString(),
    monthlyResetAt: new Date(clock.monthly).toISOString(),
    metrics,
  };
}

/** Call within the same account-serialized transaction as the existing reservation. */
export async function billingAllows(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
  metric: BillingMetric,
  units = 1,
) {
  const snapshot = await billingUsage(db, trx, accountId);
  if (!snapshot) return true;
  const usage = snapshot.metrics[metric];
  return (
    (usage.dailyLimit === null || usage.today + units <= usage.dailyLimit) &&
    (usage.monthlyLimit === null || usage.month + units <= usage.monthlyLimit)
  );
}

export async function resourcePolicy(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
) {
  const plan = await billingPlan(db, trx, accountId);
  return plan
    ? {
        plan,
        limits: (configurations.get(db)?.resourceLimits ?? resourceLimits)[
          plan === "unlimited" ? "pro" : plan
        ],
      }
    : null;
}
export type ActionReservation = {
  id: string;
  leaseId: string;
  metric: ActionMetric;
};
export class UsageLimitError extends GroveError {
  constructor(
    public resource: string,
    public resetAt: string | null,
    concurrent = false,
  ) {
    super(
      concurrent ? "ai_busy" : "usage_limit",
      concurrent
        ? "Grove is working on two AI operations. Try again shortly."
        : `Your ${resource} allowance is reached.${resetAt ? ` Resets ${resetAt}.` : " Remove an item before creating another."} Reading, editing, keyword search and export remain available.`,
      429,
    );
  }
}
/** One short shared lock for action admissions and settlements, never provider work. */
async function lockUsage(trx: Knex.Transaction, accountId: string) {
  await trx.raw("SELECT pg_advisory_xact_lock(hashtextextended(?,68142028))", [
    accountId,
  ]);
}
export async function reserveAction(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
  metric: ActionMetric,
  operation: string,
): Promise<ActionReservation | null> {
  const policy = await resourcePolicy(db, trx, accountId);
  if (!policy || policy.plan === "unlimited") return null;
  await lockUsage(trx, accountId);
  const old = await trx("action_usage")
    .where({ accountId, metric, operation })
    .first();
  if (
    old?.status === "completed" ||
    (old?.status === "reserved" && new Date(old.leaseUntil) > new Date())
  ) {
    if (old.status === "reserved")
      await trx("action_usage")
        .where({ id: old.id })
        .update({ leaseUntil: trx.raw("now()+interval '15 minutes'") });
    return { id: old.id, leaseId: old.leaseId, metric };
  }
  const {
    rows: [clock],
  } =
    await trx.raw(`SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date::text AS period,
    (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' AS reset`);
  const count = await trx("action_usage")
    .where({ accountId, metric, period: clock.period })
    .where((q) =>
      q
        .where({ status: "completed" })
        .orWhere((q) =>
          q
            .where({ status: "reserved" })
            .where("leaseUntil", ">", trx.fn.now()),
        ),
    )
    .count("id AS total")
    .first();
  if (Number(count?.total ?? 0) >= policy.limits[metric])
    throw new UsageLimitError(metric, new Date(clock.reset).toISOString());
  const leaseId = randomUUID();
  const values = {
    accountId,
    metric,
    operation,
    period: clock.period,
    status: "reserved",
    leaseId,
    leaseUntil: trx.raw("now()+interval '15 minutes'"),
  };
  const [row] = await trx("action_usage")
    .insert(values)
    .onConflict(["accountId", "metric", "operation"])
    .merge(values)
    .returning("id");
  return { id: row.id, leaseId, metric };
}
export async function settleAction(
  trx: Knex.Transaction,
  reservation: ActionReservation | null,
  status: "completed" | "released",
) {
  if (!reservation) return;
  const count = await trx("action_usage")
    .where({
      id: reservation.id,
      leaseId: reservation.leaseId,
      status: "reserved",
    })
    .modify((q) => {
      if (status === "completed") q.where("leaseUntil", ">", trx.fn.now());
    })
    .update({ status, updatedAt: trx.fn.now() });
  if (!count && status === "completed") {
    const completed = await trx("action_usage")
      .where({
        id: reservation.id,
        leaseId: reservation.leaseId,
        status: "completed",
      })
      .first("id");
    if (!completed)
      throw new GroveError(
        "usage_changed",
        "This operation expired. Try again.",
        409,
      );
  }
}
export async function settleNamedAction(
  trx: Knex.Transaction,
  accountId: string,
  metric: ActionMetric,
  operation: string,
  status: "completed" | "released",
  requireWork = false,
) {
  const row = await trx("action_usage")
    .where({ accountId, metric, operation })
    .first();
  if (row)
    await settleAction(
      trx,
      row,
      requireWork && !row.worked ? "released" : status,
    );
}
export async function markActionWork(
  trx: Knex.Transaction,
  reservation: ActionReservation | null,
) {
  if (reservation)
    await trx("action_usage")
      .where({ id: reservation.id, leaseId: reservation.leaseId })
      .update({ worked: true });
}
export async function resourceUsage(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
): Promise<ResourceUsage | null> {
  const policy = await resourcePolicy(db, trx, accountId);
  if (!policy) return null;
  const {
    rows: [clock],
  } =
    await trx.raw(`SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date::text AS period,
    (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' AS reset`);
  const rows = await trx("action_usage")
    .where({ accountId, period: clock.period })
    .groupBy("metric")
    .select(
      "metric",
      trx.raw(
        "count(*) FILTER(WHERE status='completed') AS used, count(*) FILTER(WHERE status='reserved' AND lease_until>now()) AS reserved",
      ),
    );
  const metrics = {} as ResourceUsage["metrics"];
  for (const metric of [
    "recall",
    "ask",
    "organization",
    "assistance",
  ] as const) {
    const row = rows.find((r) => r.metric === metric);
    metrics[metric] = {
      used: Number(row?.used ?? 0),
      reserved: Number(row?.reserved ?? 0),
      limit: policy.plan === "unlimited" ? null : policy.limits[metric],
    };
  }
  for (const [metric, table] of [
    ["notes", "memories"],
    ["notebooks", "projects"],
  ] as const) {
    const count = await trx(table)
      .where({ accountId })
      .count("id AS total")
      .first();
    metrics[metric] = {
      used: Number(count?.total ?? 0),
      reserved: 0,
      limit: policy.plan === "unlimited" ? null : policy.limits[metric],
    };
  }
  return {
    plan: policy.plan,
    resetAt: new Date(clock.reset).toISOString(),
    metrics,
  };
}

/** Inside the existing account-locked mutation; RLS excludes retained deleted rows. */
export async function assertCapacity(
  trx: Knex.Transaction,
  resource: "notes" | "notebooks",
  creates: number,
) {
  if (!creates) return;
  const {
    rows: [context],
  } = await trx.raw("SELECT current_setting('grove.account_id') AS account");
  const policy = await resourcePolicy(trx, trx, context.account);
  if (policy?.plan === "unlimited") return;
  const limit =
    policy?.limits[resource] ??
    (resource === "notes"
      ? legacyPolicy.maxMemories
      : legacyPolicy.maxProjects);
  const row = await trx(resource === "notes" ? "memories" : "projects")
    .count("id AS total")
    .first();
  if (Number(row?.total ?? 0) + creates > limit) {
    if (policy) throw new UsageLimitError(resource, null);
    throw new GroveError(
      resource === "notes" ? "storage_limit" : "project_limit",
      `${resource} limit reached`,
      429,
    );
  }
}

/** Provider-call slots share durable leases across foreground and all worker lanes. */
export async function withGenerationSlot<T>(
  db: Knex,
  accountId: string,
  run: (signal?: AbortSignal) => Promise<T>,
  parent = databaseSignal(),
): Promise<T> {
  const id = randomUUID();
  const acquired = await tenant(db, accountId, async (trx) => {
    const policy = await resourcePolicy(db, trx, accountId);
    if (!policy) return false;
    await lockUsage(trx, accountId);
    await trx("ai_operation_leases")
      .where({ accountId })
      .where("leaseUntil", "<=", trx.fn.now())
      .delete();
    const count = await trx("ai_operation_leases")
      .where({ accountId })
      .count("id AS total")
      .first();
    // Unlimited removes plan usage quotas, not shared safety limits.
    if (Number(count?.total ?? 0) >= policy.limits.concurrency)
      throw new UsageLimitError("concurrency", null, true);
    await trx("ai_operation_leases").insert({
      id,
      accountId,
      leaseUntil: trx.raw("now()+interval '120 seconds'"),
    });
    return true;
  });
  if (!acquired) return run(parent);
  const stop = new AbortController(),
    lost = new AbortController();
  const signal = AbortSignal.any([lost.signal, ...(parent ? [parent] : [])]);
  const heartbeat = (async () => {
    try {
      while (!stop.signal.aborted) {
        await setTimeout(30000, undefined, { signal: stop.signal });
        const count = await withDatabaseSignal(undefined, () =>
          tenant(db, accountId, (trx) =>
            trx("ai_operation_leases")
              .where({ id, accountId })
              .where("leaseUntil", ">", trx.fn.now())
              .update({ leaseUntil: trx.raw("now()+interval '120 seconds'") }),
          ),
        );
        if (!count) {
          lost.abort();
          return;
        }
      }
    } catch {
      if (!stop.signal.aborted) lost.abort();
    }
  })();
  try {
    signal.throwIfAborted();
    const value = await withDatabaseSignal(signal, () => run(signal));
    signal.throwIfAborted();
    return value;
  } finally {
    stop.abort();
    await heartbeat;
    await withDatabaseSignal(undefined, () =>
      tenant(db, accountId, (trx) =>
        trx("ai_operation_leases").where({ id, accountId }).delete(),
      ),
    );
  }
}
