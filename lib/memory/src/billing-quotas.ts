import type { Knex } from "@lib/database";
import {
  billingLimits,
  type BillingMetric,
  type BillingUsage,
  type PlanLimits,
} from "@lib/shared/billing";

type Configuration = {
  enabled: (subject: string) => Promise<boolean>;
  priceIds: string[];
  productId?: string;
  limits?: Record<"free" | "pro", PlanLimits>;
};
// Each explicitly configured runtime owns its policy; tests and self-hosted installs
// cannot accidentally inherit another database's cloud policy.
const configurations = new WeakMap<Knex, Configuration>();
export function configureBillingQuotas(db: Knex, configuration: Configuration) {
  configurations.set(db, configuration);
}
export async function billingUsage(
  db: Knex,
  trx: Knex.Transaction,
  accountId: string,
): Promise<BillingUsage | null> {
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
  const paid = await trx("billing_subscriptions")
    .where({ accountId })
    .whereIn("status", ["active", "trialing"])
    .where((query) => {
      query.whereIn("priceId", config.priceIds);
      if (config.productId) query.orWhere({ productId: config.productId });
    })
    .where("periodEnd", ">", trx.fn.now())
    .first("id");
  const plan = override ?? (paid ? "pro" : "free");
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
