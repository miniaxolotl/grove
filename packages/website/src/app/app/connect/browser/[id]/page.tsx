import { notFound } from "next/navigation";
import { uuidSchema } from "@lib/shared/contracts";
import { BrowserConnectionApproval } from "@/components/dashboard/connections";

export default async function BrowserConnectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  return <BrowserConnectionApproval key={id} id={id} />;
}
