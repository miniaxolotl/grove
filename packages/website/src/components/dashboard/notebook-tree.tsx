"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Folder, FolderOpen, GripVertical } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import type { Project } from "@/lib/dashboard-api";
import { notebookPath } from "@/lib/notebooks";
import { IconButton } from "./ui/button";
import {
  useNotebookDrop,
  useWorkspaceDrag,
  type WorkspaceDragItem,
} from "./memory-drag";
import { NotebookPages } from "./notebook-pages";

/** Disclosure navigation uses ordinary links/buttons, with full native keyboard access. */
export function NotebookTree({
  projects,
  selectedId,
  query = "",
  actions,
  renderItem,
  defaultExpanded = false,
  showNotes = false,
}: {
  projects: readonly Project[];
  selectedId?: string | null;
  query?: string;
  actions?: (project: Project) => ReactNode;
  renderItem?: (project: Project) => ReactNode;
  defaultExpanded?: boolean;
  showNotes?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(projects.map((p) => p.id));
  const ancestors = new Set(
    notebookPath(projects, selectedId).map((p) => p.id),
  );
  const matching = query.trim()
    ? new Set(
        projects
          .filter((p) =>
            p.name
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .flatMap((p) => notebookPath(projects, p.id).map((p) => p.id)),
      )
    : null;
  const children = (parent: string | null) =>
    sorted.filter(
      (p) =>
        (p.parentId && ids.has(p.parentId) ? p.parentId : null) === parent &&
        (!matching || matching.has(p.id)),
    );
  function branch(parent: string | null, depth = 0): ReactNode {
    if (depth > projects.length) return null;
    return (
      <ul className="notebook-tree-list" data-deep={depth > 4 || undefined}>
        {children(parent).map((project) => {
          const hasChildren = showNotes || children(project.id).length > 0;
          const open =
            matching ||
            (expanded[project.id] ??
              (defaultExpanded || ancestors.has(project.id)));
          const Icon = hasChildren && open ? FolderOpen : Folder;
          return (
            <NotebookBranch
              key={project.id}
              project={project}
              name={notebookPath(projects, project.id)
                .map((p) => p.name)
                .join(" / ")}
              current={project.id === selectedId}
              open={!!open}
              hasChildren={hasChildren}
              expand={() =>
                setExpanded((value) => ({ ...value, [project.id]: true }))
              }
              row={
                <>
                  {hasChildren ? (
                    <IconButton
                      label={`${open ? "Collapse" : "Expand"} ${project.name}`}
                      aria-expanded={!!open}
                      className="notebook-disclosure"
                      onClick={() =>
                        setExpanded({ ...expanded, [project.id]: !open })
                      }
                    >
                      <ChevronRight size={14} />
                    </IconButton>
                  ) : (
                    <span className="notebook-disclosure-spacer" />
                  )}
                  {renderItem ? (
                    renderItem(project)
                  ) : (
                    <Link
                      className="notebook-tree-link"
                      href={`/app/projects/${project.id}`}
                      aria-current={
                        project.id === selectedId ? "page" : undefined
                      }
                      title={notebookPath(projects, project.id)
                        .map((p) => p.name)
                        .join(" / ")}
                    >
                      <Icon size={16} strokeWidth={1.6} />
                      <span>{project.name}</span>
                    </Link>
                  )}
                  {actions && (
                    <div className="notebook-tree-actions">
                      {actions(project)}
                    </div>
                  )}
                </>
              }
            >
              {hasChildren && open && (
                <>
                  {branch(project.id, depth + 1)}
                  {showNotes && <NotebookPages projectId={project.id} />}
                </>
              )}
            </NotebookBranch>
          );
        })}
      </ul>
    );
  }
  return <div className="notebook-tree">{branch(null)}</div>;
}

function NotebookBranch({
  project,
  name,
  current,
  open,
  hasChildren,
  expand,
  row,
  children,
}: {
  project: Project;
  name: string;
  current: boolean;
  open: boolean;
  hasChildren: boolean;
  expand: () => void;
  row: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const { busy } = useWorkspaceDrag();
  const {
    setNodeRef: setDropRef,
    isOver,
    dragging,
    invalid,
  } = useNotebookDrop(project.id, name);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } =
    useDraggable({
      id,
      data: { item: { kind: "notebook", project } satisfies WorkspaceDragItem },
      disabled: busy,
    });
  useEffect(() => {
    if (!isOver || open || !hasChildren) return;
    const timer = setTimeout(expand, 550);
    return () => clearTimeout(timer);
  }, [isOver, open, hasChildren, expand]);
  return (
    <li ref={setNodeRef} data-dragging={isDragging || undefined}>
      <div
        ref={setDropRef}
        className="notebook-tree-row"
        data-current={current || undefined}
        data-destination={project.id}
        data-drop-active={isOver || undefined}
        data-drop-disabled={(dragging && invalid) || undefined}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="drag-handle notebook-drag-handle"
          disabled={busy}
          aria-label={`Move notebook ${project.name} with drag or keyboard`}
          title="Drag to nest, or press Space to move"
        >
          <GripVertical size={14} />
        </button>
        {row}
      </div>
      {children}
    </li>
  );
}
