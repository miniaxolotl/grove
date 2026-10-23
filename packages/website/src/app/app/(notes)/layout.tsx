import { NoteDocument } from "@/components/dashboard/note-document";

export default function NoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NoteDocument>{children}</NoteDocument>;
}
