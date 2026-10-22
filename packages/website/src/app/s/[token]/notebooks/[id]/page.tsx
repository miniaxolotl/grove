import { readPublicShare } from "@/lib/public-sharing";
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
  const data = await readPublicShare(token, "notebooks", id, cursor);
  return (
    <PublicReader
      data={data}
      token={token}
      path={`/s/${token}/notebooks/${id}`}
    />
  );
}
