import { MemoryInspector } from "@/components/dashboard/memory-inspector";
export default async function MemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; from?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return (
    <MemoryInspector
      fullPage
      id={id}
      initialPreview={query.mode !== "edit"}
      journal={query.from === "journal"}
    />
  );
}
