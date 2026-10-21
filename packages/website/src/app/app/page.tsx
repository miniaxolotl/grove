import { MemoryLibrary } from "@/components/dashboard/memory-library";
export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ notebook?: string; sort?: string }>;
}) {
  const { notebook, sort } = await searchParams;
  return (
    <MemoryLibrary
      key={`${notebook ?? "all"}:${sort ?? ""}`}
      initialProject={notebook}
      initialSort={sort === "created_desc" ? "created_desc" : "updated_desc"}
    />
  );
}
