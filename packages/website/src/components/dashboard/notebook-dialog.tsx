import type { Project } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { ProjectForm } from "./project-form";
import { NotebookLifecycleDialog } from "./notebook-lifecycle";
import { NotebookMove } from "./notebook-move";
import { useNotebooks } from "./notebooks-provider";

export type NotebookAction =
  | { mode: "create"; parentId?: string; project?: never }
  | { mode: "rename" | "move"; project: Project; parentId?: never }
  | {
      mode: "archive" | "restore" | "delete";
      project: Project;
      parentId?: never;
    };
export function NotebookDialog({
  action,
  close,
  onSaved,
}: {
  action: NotebookAction;
  close: () => void;
  onSaved?: (project: Project) => void;
}) {
  const notebooks = useNotebooks();
  if (
    action.mode === "archive" ||
    action.mode === "restore" ||
    action.mode === "delete"
  )
    return (
      <NotebookLifecycleDialog
        project={action.project}
        action={action.mode}
        close={close}
      />
    );
  return (
    <Dialog
      title={
        action.mode === "move"
          ? "Move notebook"
          : action.project
            ? "Rename notebook"
            : action.parentId
              ? "New sub-notebook"
              : "New notebook"
      }
      close={close}
    >
      {action.mode === "move" ? (
        <NotebookMove
          key={notebooks.layoutReview}
          project={
            notebooks.projects.find((p) => p.id === action.project.id) ??
            action.project
          }
          cancel={close}
          done={(project) => {
            close();
            onSaved?.(project);
          }}
        />
      ) : (
        <ProjectForm
          mode={action.mode}
          project={action.project}
          parentId={action.parentId}
          cancel={close}
          done={(project) => {
            close();
            onSaved?.(project);
          }}
        />
      )}
    </Dialog>
  );
}
