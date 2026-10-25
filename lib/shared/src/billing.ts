export const billingFlagKey = "billing-enabled";
export const billingPriceFlagKey = "billing-pro-monthly-usd";
/** User-facing actions are independent of provider-attempt safety budgets. */
export type ActionMetric = "recall" | "ask" | "organization" | "assistance";
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
    concurrency: 2,
  },
  pro: {
    notes: 50000,
    notebooks: 500,
    recall: 150000,
    ask: 1500,
    organization: 5000,
    assistance: 250,
    concurrency: 2,
  },
};
export type ResourceUsage = {
  plan: "free" | "pro" | "unlimited";
  resetAt: string;
  metrics: Record<
    ActionMetric | "notes" | "notebooks",
    { used: number; reserved: number; limit: number | null }
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
};
