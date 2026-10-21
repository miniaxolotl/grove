"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { Plus, Inbox, Folder, ChevronDown } from "lucide-react";
import { useNotebooks, useCurrentNotebook } from "./notebooks-provider";
import { NotebookTree } from "./notebook-tree";
import { NotebookDialog, type NotebookAction } from "./notebook-dialog";
import { IconButton } from "./ui/button";
import {
  NotebookDropTarget,
  useNotebookDrop,
  useWorkspaceDrag,
} from "./memory-drag";
import { ActionMenu } from "./ui/action-menu";
import { ShareDialog } from "./share-dialog";
import { NotebookActions } from "./notebook-actions";

export function NotebookExplorer() {
  const { projects, loading, error, reload } = useNotebooks();
  const path = usePathname();
  const currentNotebook = useCurrentNotebook();
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const open = openPath === path;
  const id = useId();
  const { active } = useWorkspaceDrag();
  const { setNodeRef, isOver } = useNotebookDrop(null, "Unfiled");
  return (
    <div className="notebook-browser">
      <button
        className="notebook-browser-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpenPath(open ? null : path)}
      >
        <Folder size={16} /> Notebooks <ChevronDown size={14} />
      </button>
      <section
        id={id}
        className="notebook-explorer"
        data-mobile-open={open || undefined}
        aria-label="Your notebooks"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpenPath(null);
        }}
      >
        <div className="notebook-explorer-heading">
          <span>Notebooks</span>
          <Link href="/app/projects" className="notebook-manage">
            Manage
          </Link>
          <IconButton
            label="Create notebook"
            onClick={() => setAction({ mode: "create" })}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        <Link
          ref={setNodeRef}
          className="notebook-personal"
          href="/app?notebook=personal"
          aria-current={currentNotebook === null ? "page" : undefined}
          data-destination="personal"
          data-drop-active={isOver || undefined}
        >
          <Inbox size={15} />
          Unfiled
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
            selectedId={currentNotebook}
            actions={(project) => (
              <ActionMenu label={`Notebook actions for ${project.name}`}>
                <NotebookActions
                  project={project}
                  onAction={setAction}
                  onShare={() => setSharing(project.id)}
                />
              </ActionMenu>
            )}
          />
        ) : (
          <p className="notebook-tree-message">
            <button
              className="text-button"
              onClick={() => setAction({ mode: "create" })}
            >
              Create a notebook
            </button>
          </p>
        )}
        {action && (
          <NotebookDialog action={action} close={() => setAction(null)} />
        )}
        {sharing && (
          <ShareDialog
            target={{ kind: "notebook", id: sharing }}
            close={() => setSharing(null)}
          />
        )}
      </section>
    </div>
  );
}
