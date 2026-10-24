import { createFlagsDiscoveryEndpoint } from "flags/next";
import { getProviderData } from "@flags-sdk/vercel";
import { billingEnabled, billingMonthlyUsd } from "@/lib/flags";

export const GET = createFlagsDiscoveryEndpoint(() =>
  getProviderData({ billingEnabled, billingMonthlyUsd }),
);
