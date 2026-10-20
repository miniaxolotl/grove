"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Plus, FilePlus2, Pencil, FolderInput, UserRound } from "lucide-react";
import { useNotebooks } from "./notebooks-provider";
import { NotebookTree } from "./notebook-tree";
import { NotebookDialog, type NotebookAction } from "./notebook-dialog";
import { IconButton } from "./ui/button";
import {
  NotebookDropTarget,
  useNotebookDrop,
  useWorkspaceDrag,
} from "./memory-drag";
import { ActionMenu } from "./ui/action-menu";

export function NotebookExplorer() {
  const { projects, loading, error, reload } = useNotebooks();
  const path = usePathname();
  const [action, setAction] = useState<NotebookAction | null>(null);
  const { active } = useWorkspaceDrag();
  const { setNodeRef, isOver } = useNotebookDrop(null, "Personal");
  return (
    <section className="notebook-explorer" aria-label="Your notebooks">
      <div className="notebook-explorer-heading">
        <Link href="/app/projects">Your notebooks</Link>
        <IconButton label="Create notebook" onClick={() => setAction({})}>
          <Plus size={14} />
        </IconButton>
      </div>
      <Link
        ref={setNodeRef}
        className="notebook-personal"
        href="/app?notebook=personal"
        data-destination="personal"
        data-drop-active={isOver || undefined}
      >
        <UserRound size={15} />
        Personal
      </Link>
      {active?.kind === "notebook" && (
        <NotebookDropTarget projectId={null} name="Top level" root />
      )}
      {loading ? (
        <p className="notebook-tree-message">Opening notebooks…</p>
      ) : error ? (
        <button className="text-button" onClick={reload}>
          Retry notebooks
        </button>
      ) : projects.length ? (
        <NotebookTree
          showNotes
          projects={projects}
          selectedId={
            path.startsWith("/app/projects/") ? path.split("/")[3] : null
          }
          actions={(project) => (
            <ActionMenu label={`Notebook actions for ${project.name}`}>
              <Link href={`/app/notes/new?notebook=${project.id}`}>
                <FilePlus2 size={15} />
                New note
              </Link>
              <button onClick={() => setAction({ parentId: project.id })}>
                <Plus size={15} />
                New sub-notebook
              </button>
              <button onClick={() => setAction({ project })}>
                <Pencil size={15} />
                Rename
              </button>
              <button onClick={() => setAction({ project, move: true })}>
                <FolderInput size={15} />
                Move
              </button>
            </ActionMenu>
          )}
        />
      ) : (
        <p className="notebook-tree-message">
          <button className="text-button" onClick={() => setAction({})}>
            Create a notebook
          </button>
        </p>
      )}
      {action && (
        <NotebookDialog action={action} close={() => setAction(null)} />
      )}
    </section>
  );
}
