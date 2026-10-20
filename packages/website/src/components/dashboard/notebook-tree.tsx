"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { Project } from "@/lib/dashboard-api";
import { notebookPath } from "@/lib/notebooks";
import { IconButton } from "./ui/button";

/** Disclosure navigation uses ordinary links/buttons, with full native keyboard access. */
export function NotebookTree({
  projects,
  selectedId,
  query = "",
  actions,
  renderItem,
  defaultExpanded = false,
}: {
  projects: readonly Project[];
  selectedId?: string | null;
  query?: string;
  actions?: (project: Project) => ReactNode;
  renderItem?: (project: Project) => ReactNode;
  defaultExpanded?: boolean;
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
          const hasChildren = children(project.id).length > 0;
          const open =
            matching ||
            (expanded[project.id] ??
              (defaultExpanded || ancestors.has(project.id)));
          const Icon = hasChildren && open ? FolderOpen : Folder;
          return (
            <li key={project.id}>
              <div
                className="notebook-tree-row"
                data-current={project.id === selectedId || undefined}
              >
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
              </div>
              {hasChildren && open && branch(project.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }
  return <div className="notebook-tree">{branch(null)}</div>;
}
