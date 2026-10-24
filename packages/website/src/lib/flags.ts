import "server-only";
import { auth } from "@clerk/nextjs/server";
import { flag, dedupe } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";
import { billingFlagKey } from "@lib/shared/billing";

const identify = dedupe(async () => {
  if (!process.env.CLERK_SECRET_KEY) return {};
  const { userId } = await auth();
  return userId ? { user: { id: userId } } : {};
});
export const billingEnabled = flag<boolean, { user?: { id: string } }>({
  key: billingFlagKey,
  description:
    "Offer Free and Pro subscriptions and enforce plan usage allowances",
  defaultValue: false,
  identify,
  adapter: vercelAdapter,
});

export async function showBilling() {
  if (process.env.BILLING_CONFIGURED !== "true") return false;
  return billingEnabled();
}
