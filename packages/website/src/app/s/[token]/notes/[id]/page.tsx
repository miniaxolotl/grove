import { initialPublicReader } from "@/lib/public-sharing";
import { site } from "@/lib/site";
import { PublicReader } from "@/components/sharing/public-reader";

export default async function SharedNote({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const initial = await initialPublicReader(token, "notes", id);
  return (
    <PublicReader
      initial={initial}
      token={token}
      origin={site.url}
      path={`/s/${token}/notes/${id}`}
    />
  );
}
