import { NoteEditorPage } from "@/components/dashboard/note-editor-page";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ notebook?: string; from?: string }>;
}) {
  const query = await searchParams;
  return (
    <NoteEditorPage
      notebook={typeof query.notebook === "string" ? query.notebook : undefined}
      journal={query.from === "journal"}
    />
  );
}
