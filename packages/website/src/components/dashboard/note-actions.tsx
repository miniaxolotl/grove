import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Download,
  FolderInput,
  Trash2,
} from "lucide-react";

/** Common order for list actions and the reader's overflow menu. */
export function NoteActions({
  inactive,
  locked,
  busy,
  onMove,
  onExport,
  onArchive,
  onDelete,
  before,
  details,
  sharing,
  row = false,
}: {
  inactive: boolean;
  locked: boolean;
  busy: boolean;
  onMove: () => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
  before?: ReactNode;
  details?: ReactNode;
  sharing?: ReactNode;
  row?: boolean;
}) {
  const style = row ? "app-button secondary" : undefined;
  return (
    <>
      {before}
      <button
        type="button"
        className={style}
        disabled={locked}
        onClick={onMove}
      >
        <FolderInput size={15} />
        Move
      </button>
      <button type="button" className={style} onClick={onExport}>
        <Download size={15} />
        Export…
      </button>
      {sharing}
      {details}
      <button
        type="button"
        className={style}
        disabled={locked}
        onClick={onArchive}
      >
        {inactive ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        {inactive ? "Restore" : "Archive"}
      </button>
      <button
        type="button"
        className={
          row ? "app-button danger" : "action-group-start action-danger"
        }
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete note…
      </button>
    </>
  );
}
