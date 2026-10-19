import { notFound } from "next/navigation";
import { uuidSchema } from "@lib/shared/contracts";
import { ConnectAgent } from "@/components/dashboard/connect-agent";

export default async function ConnectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  return <ConnectAgent key={id} id={id} />;
}
