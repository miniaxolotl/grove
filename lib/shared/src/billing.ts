export const billingFlagKey = "billing-enabled";
export const billingPriceFlagKey = "billing-pro-monthly-usd";
export const billingPriceYearlyFlagKey = "billing-pro-yearly-usd";
/** Anonymous (no-account) grace: local-only extension use before signup nudge. */
export const anonymousGraceDays = 14;
/** Single-use Pro trial length once an account starts it. */
export const trialDurationDays = 7;
export type TrialState =
  | { eligible: true; consumedAt: null }
  | { eligible: false; consumedAt: string; resetAt: string | null };
/** Effective access, not a claim that an administrator grant cancels a purchase. */
export type AccountPlan = {
  tier: "free" | "pro" | "unlimited";
  source: "free" | "paid" | "trial" | "complimentary";
};
/** User-facing actions are independent of provider-attempt safety budgets. */
export type ActionMetric =
  | "recall"
  | "ask"
  | "organization"
  | "assistance"
  | "writing";
export type ActionUsageReceipt = {
  feature: ActionMetric;
  status: "fresh" | "cached" | "mixed";
  actions: 0 | 0.2 | 1 | null;
};
export type ResourceLimits = Record<
  ActionMetric | "notes" | "notebooks" | "concurrency",
  number
>;
export const resourceLimits: Record<"free" | "pro", ResourceLimits> = {
  free: {
    notes: 10000,
    notebooks: 100,
    recall: 30000,
    ask: 300,
    organization: 1000,
    assistance: 50,
    writing: 100,
    concurrency: 2,
  },
  pro: {
    notes: 50000,
    notebooks: 500,
    recall: 150000,
    ask: 1500,
    organization: 5000,
    assistance: 250,
    writing: 1000,
    concurrency: 2,
  },
};
/** Daily burst caps for AI rewrites; monthly allowances above still govern. */
export const writingDailyLimits: Record<"free" | "pro", number> = {
  free: 30,
  pro: 200,
};
export type ResourceUsage = {
  plan: "free" | "pro" | "unlimited";
  resetAt: string;
  metrics: Record<
    ActionMetric | "notes" | "notebooks",
    {
      used: number;
      reserved: number;
      limit: number | null;
      cache?: { cached: number; fresh: number };
    }
  >;
};
export type BillingMetric =
  | "generation"
  | "research"
  | "transcription"
  | "synthesis";
export type PlanLimits = Record<
  BillingMetric,
  { daily: number | null; monthly: number }
>;
export const billingLimits: Record<"free" | "pro", PlanLimits> = {
  free: {
    generation: { daily: 1000, monthly: 31000 },
    research: { daily: 20, monthly: 620 },
    transcription: { daily: null, monthly: 7200000 },
    synthesis: { daily: null, monthly: 7200000 },
  },
  pro: {
    generation: { daily: 5000, monthly: 155000 },
    research: { daily: 100, monthly: 3100 },
    transcription: { daily: null, monthly: 28800000 },
    synthesis: { daily: null, monthly: 28800000 },
  },
};
export const billingUnits = {
  generation: "requests",
  research: "calls",
  transcription: "milliseconds",
  synthesis: "milliseconds",
} as const;
export type BillingUsage = {
  plan: "free" | "pro" | "unlimited";
  dailyResetAt: string;
  monthlyResetAt: string;
  metrics: Record<
    BillingMetric,
    {
      today: number;
      month: number;
      dailyLimit: number | null;
      monthlyLimit: number | null;
    }
  >;
};
export type BillingStatus = {
  plan?: AccountPlan | null;
  resources?: ResourceUsage | null;
  proResources?: ResourceLimits;
  units: typeof billingUnits;
  proLimits: PlanLimits;
  enabled: boolean;
  customer: boolean;
  subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    periodEnd: string;
  } | null;
  usage: BillingUsage | null;
  prices: { interval: "month" | "year"; amount: number; currency: string }[];
  trial: TrialState | null;
};
/** Owner-only on-demand breakdown; never contacts the payment provider. */
export type AccountPlanUsage = {
  plan: AccountPlan | null;
  resources: ResourceUsage | null;
  usage: BillingUsage | null;
  units: typeof billingUnits;
};
