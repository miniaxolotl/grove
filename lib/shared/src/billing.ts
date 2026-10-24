export const billingFlagKey = "billing-enabled";
export const billingPriceFlagKey = "billing-pro-monthly-usd";
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
  plan: "free" | "pro";
  dailyResetAt: string;
  monthlyResetAt: string;
  metrics: Record<
    BillingMetric,
    {
      today: number;
      month: number;
      dailyLimit: number | null;
      monthlyLimit: number;
    }
  >;
};
export type BillingStatus = {
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
