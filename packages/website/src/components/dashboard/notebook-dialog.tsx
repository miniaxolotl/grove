import type { Project } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { ProjectForm } from "./project-form";

export type NotebookAction = {
  project?: Project;
  parentId?: string;
  move?: boolean;
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
  return (
    <Dialog
      title={
        action.move
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
        project={action.project}
        parentId={action.parentId}
        done={(project) => {
          close();
          onSaved?.(project);
        }}
      />
    </Dialog>
  );
}
