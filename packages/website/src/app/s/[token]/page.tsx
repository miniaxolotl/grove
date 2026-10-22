import { readPublicShare } from "@/lib/public-sharing";
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
  const data = await readPublicShare(token, "root", undefined, cursor);
  return <PublicReader data={data} token={token} path={`/s/${token}`} />;
}
