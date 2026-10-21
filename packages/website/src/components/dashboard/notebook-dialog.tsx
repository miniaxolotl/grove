import type { Project } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { ProjectForm } from "./project-form";

export type NotebookAction =
  | { mode: "create"; parentId?: string; project?: never }
  | { mode: "rename" | "move"; project: Project; parentId?: never };
export function NotebookDialog({
  action,
  close,
  onSaved,
}: {
  action: NotebookAction;
  close: () => void;
  onSaved?: (project: Project) => void;
}) {
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
    </Dialog>
  );
}
