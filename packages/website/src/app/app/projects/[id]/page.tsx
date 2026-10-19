import { MemoryContext } from "@/components/dashboard/context";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemoryContext key={id} projectId={id} />;
}
