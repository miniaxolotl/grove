import type { ReactNode } from "react";
import {
  workspaceCommand,
  type WorkspaceCommand,
} from "@/lib/workspace-commands";
import { CommandIcon } from "./ui/command-icon";

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
}) {
  function action(command: WorkspaceCommand) {
    return (
      <button
        type="button"
        className={
          command.danger ? "action-group-start action-danger" : undefined
        }
        disabled={command.disabled}
        onClick={command.run}
      >
        <CommandIcon name={command.icon} />
        {command.menuLabel ?? command.label}
      </button>
    );
  }
  return (
    <>
      {before}
      {action(workspaceCommand("note-move", onMove, { disabled: locked }))}
      {action(workspaceCommand("note-export", onExport))}
      {sharing}
      {details}
      {action(
        workspaceCommand(
          inactive ? "note-restore" : "note-archive",
          onArchive,
          { disabled: locked },
        ),
      )}
      {action(workspaceCommand("note-delete", onDelete, { disabled: busy }))}
    </>
  );
}
