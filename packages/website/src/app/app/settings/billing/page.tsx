import { notFound } from "next/navigation";
import { BillingPanel } from "@/components/dashboard/billing-panel";
import { showBilling } from "@/lib/flags";

export default async function BillingPage() {
  if (!(await showBilling())) notFound();
  return <BillingPanel />;
}
