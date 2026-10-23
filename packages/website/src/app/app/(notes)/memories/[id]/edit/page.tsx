import { redirect } from "next/navigation";

export default async function EditNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  redirect(
    `/app/memories/${id}?mode=edit${query.from === "journal" ? "&from=journal" : ""}`,
  );
}
