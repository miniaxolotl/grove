import { initialPublicReader } from "@/lib/public-sharing";
import { site } from "@/lib/site";
import { PublicReader } from "@/components/sharing/public-reader";

export default async function SharedNotebook({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { token, id } = await params;
  const { cursor } = await searchParams;
  const initial = await initialPublicReader(token, "notebooks", id, cursor);
  return (
    <PublicReader
      initial={initial}
      origin={site.url}
      token={token}
      path={`/s/${token}/notebooks/${id}`}
    />
  );
}
