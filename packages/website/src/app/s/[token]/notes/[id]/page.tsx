import { readPublicShare } from "@/lib/public-sharing";
import { PublicReader } from "@/components/sharing/public-reader";

export default async function SharedNote({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const data = await readPublicShare(token, "notes", id);
  return (
    <PublicReader data={data} token={token} path={`/s/${token}/notes/${id}`} />
  );
}
