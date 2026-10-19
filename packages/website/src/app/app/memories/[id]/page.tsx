import { MemoryLibrary } from "@/components/dashboard/memory-library";
export default async function MemoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <MemoryLibrary initialId={(await params).id} />;
}
