import { initialPublicReader } from "@/lib/public-sharing";
import { site } from "@/lib/site";
import { PublicReader } from "@/components/sharing/public-reader";

export default async function SharedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { token } = await params;
  const { cursor } = await searchParams;
  const initial = await initialPublicReader(token, "root", undefined, cursor);
  return (
    <PublicReader
      initial={initial}
      token={token}
      origin={site.url}
      path={`/s/${token}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`}
    />
  );
}
