import { NoteEditorPage } from "@/components/dashboard/note-editor-page";

export default async function EditNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <NoteEditorPage id={id} journal={query.from === "journal"} />;
}
