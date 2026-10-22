import { MemoryInspector } from "@/components/dashboard/memory-inspector";
import { SourceRevision } from "@/components/dashboard/source-revision";
export default async function MemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; from?: string; revision?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const revision = Number(query.revision);
  if (Number.isInteger(revision) && revision > 0 && revision <= 2147483647)
    return <SourceRevision id={id} version={revision} />;
  return (
    <MemoryInspector
      fullPage
      id={id}
      initialPreview={query.mode !== "edit"}
      journal={query.from === "journal"}
    />
  );
}
