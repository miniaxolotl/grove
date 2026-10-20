import { MemoryLibrary } from "@/components/dashboard/memory-library";
export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ notebook?: string }>;
}) {
  const { notebook } = await searchParams;
  return <MemoryLibrary key={notebook ?? "all"} initialProject={notebook} />;
}
