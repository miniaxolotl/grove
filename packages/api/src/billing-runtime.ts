import Stripe from "stripe";
import { createClient } from "@vercel/flags-core";
import type { ServerEnvironment } from "@lib/environment";
import { configureBillingQuotas, type MemoryService } from "@lib/memory";
import { billingFlagKey, type PlanLimits } from "@lib/shared/billing";
import { Billing } from "./billing.ts";

export function createBilling(env: ServerEnvironment, service: MemoryService) {
  if (!env.BILLING_CONFIGURED) return null;
  const client = createClient(env.FLAGS!, { staleIfError: 60 });
  const enabled = async (subject: string) => {
    const result = await client.evaluate<boolean, { user: { id: string } }>(
      billingFlagKey,
      false,
      { user: { id: subject } },
    );
    return result.value === true;
  };
  const limits = (tier: "FREE" | "PRO"): PlanLimits => ({
    generation: {
      daily: env[`BILLING_${tier}_GENERATION_DAILY`],
      monthly: env[`BILLING_${tier}_GENERATION_MONTHLY`],
    },
    research: {
      daily: env[`BILLING_${tier}_RESEARCH_DAILY`],
      monthly: env[`BILLING_${tier}_RESEARCH_MONTHLY`],
    },
    transcription: {
      daily: null,
      monthly: env[`BILLING_${tier}_TRANSCRIPTION_MONTHLY_MS`],
    },
    synthesis: {
      daily: null,
      monthly: env[`BILLING_${tier}_SYNTHESIS_MONTHLY_CHARACTERS`],
    },
  });
  const prices = {
    ...(env.STRIPE_PRO_MONTHLY_PRICE_ID
      ? { month: env.STRIPE_PRO_MONTHLY_PRICE_ID }
      : {}),
    ...(env.STRIPE_PRO_YEARLY_PRICE_ID
      ? { year: env.STRIPE_PRO_YEARLY_PRICE_ID }
      : {}),
  };
  configureBillingQuotas(service.db, {
    enabled,
    priceIds: Object.values(prices),
    limits: { free: limits("FREE"), pro: limits("PRO") },
  });
  const billing = new Billing(service, {
    stripe: new Stripe(env.STRIPE_SECRET_KEY!, {
      timeout: 5000,
      maxNetworkRetries: 1,
    }),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
    siteUrl: env.SITE_URL,
    prices,
    enabled,
    proLimits: limits("PRO"),
  });
  service.beforeAccountDeletion = (trx, accountId) =>
    billing.cancelForDeletion(accountId, trx);
  return { billing, close: () => client.shutdown() };
}
