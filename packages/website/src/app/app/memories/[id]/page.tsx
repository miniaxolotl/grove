import { MemoryInspector } from "@/components/dashboard/memory-inspector";
export default async function MemoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <MemoryInspector fullPage id={(await params).id} />;
}
