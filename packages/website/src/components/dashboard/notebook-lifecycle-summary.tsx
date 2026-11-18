import type { NotebookLifecycleAction } from "@lib/shared/notebook-lifecycle";

const consequences = {
  archive:
    "Restore from Archived notebooks. Previously archived notes stay archived.",
  restore: "Previously archived or expired notes stay hidden.",
  delete: "You can’t restore these notebooks, notes or their history in Grove.",
};

const sharing = {
  archive:
    "Direct links turn off. Restoring can show these contents in shared parent notebooks, but won’t turn direct links back on.",
  restore:
    "Direct links stay off. Shared parent notebooks can show these contents again.",
  delete:
    "Direct share links stop working. The contents disappear from shared parent notebooks.",
};

export function notebookDraftWarning(
  action: NotebookLifecycleAction,
  count: number,
) {
  const verb = {
    archive: "archiving",
    restore: "restoring",
    delete: "deleting",
  }[action];
  return `Resolve ${count} ${count === 1 ? "draft" : "drafts"} before ${verb}.`;
}

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
