import type { NotebookLifecycleAction } from "@lib/shared/notebook-lifecycle";

const consequences = {
  archive:
    "Restore from Archived notebooks. Notes already archived stay archived.",
  restore:
    "Only notes archived with these notebooks return. Expired notes stay hidden, and retention dates don’t change.",
  delete:
    "Removes these notebooks, their notes and history from Grove without erasing retained data. You can’t undo this in Grove.",
};

const sharing = {
  archive:
    "Direct share links stop working. Restoring won’t turn them back on, but shared parent notebooks can show restored contents again.",
  restore:
    "Direct share links stay off. Shared parent notebooks can show restored contents again.",
  delete:
    "Direct share links stop working, and shared parent notebooks no longer show these contents.",
};

export function NotebookLifecycleSummary({
  action,
  notebooks,
  notes,
}: {
  action: NotebookLifecycleAction;
  notebooks: number;
  notes: number;
}) {
  return (
    <div className="grid gap-2 text-sm">
      <p>
        {notebooks} {notebooks === 1 ? "notebook" : "notebooks"} and {notes}{" "}
        {notes === 1 ? "note" : "notes"}, including all sub-notebooks.
      </p>
      <p>{consequences[action]}</p>
      <p>{sharing[action]}</p>
    </div>
  );
}
