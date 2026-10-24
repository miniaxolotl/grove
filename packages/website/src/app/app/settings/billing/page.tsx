import { notFound } from "next/navigation";
import { BillingPanel } from "@/components/dashboard/billing-panel";

export default function BillingPage() {
  // Keep existing customers' cancellation accessible during a sales pause.
  if (process.env.BILLING_CONFIGURED !== "true") notFound();
  return <BillingPanel />;
}
