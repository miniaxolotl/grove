import { createFlagsDiscoveryEndpoint } from "flags/next";
import { getProviderData } from "@flags-sdk/vercel";
import { billingEnabled } from "@/lib/flags";

export const GET = createFlagsDiscoveryEndpoint(() =>
  getProviderData({ billingEnabled }),
);
