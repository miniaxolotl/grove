export const billingFlagKey = "billing-enabled";
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
    generation: { daily: 10, monthly: 100 },
    research: { daily: 3, monthly: 10 },
    transcription: { daily: null, monthly: 600000 },
    synthesis: { daily: null, monthly: 10000 },
  },
  pro: {
    generation: { daily: 200, monthly: 2000 },
    research: { daily: 20, monthly: 200 },
    transcription: { daily: null, monthly: 7200000 },
    synthesis: { daily: null, monthly: 200000 },
  },
};
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
