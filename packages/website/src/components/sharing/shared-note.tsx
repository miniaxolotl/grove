"use client";
import { memo } from "react";
import type { PublicShare } from "@lib/shared/sharing";
import { Markdown } from "@/components/dashboard/markdown";
import type { sharedNoteDocument } from "@/lib/shared-note-document";
import type { NoteHeading } from "@/lib/note-headings";

export const SharedNote = memo(function SharedNote({
  note,
  root,
  origin,
  document: { content, headings },
  copy,
}: {
  note: NonNullable<PublicShare["note"]>;
  root: string;
  origin: string;
  document: ReturnType<typeof sharedNoteDocument>;
  copy: (heading: NoteHeading) => void;
}) {
  return (
    <Markdown
      media={{ noteId: note.id }}
      headings={headings}
      onCopySection={copy}
      shared={{ root, origin, linkedNoteIds: note.linkedNoteIds }}
    >
      {content}
    </Markdown>
  );
});
