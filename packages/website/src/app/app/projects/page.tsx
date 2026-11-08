"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "@/components/dashboard/workspace-cache";
import { ActionMenu } from "@/components/dashboard/ui/action-menu";
import { ArchiveRestore, Folder, Plus, Trash2, X } from "lucide-react";
import { ShareDialog } from "@/components/dashboard/share-dialog";
import { LoadError } from "@/components/dashboard/load-error";
import {
  NotebookDialog,
  type NotebookAction,
} from "@/components/dashboard/notebook-dialog";
import { NotebookTree } from "@/components/dashboard/notebook-tree";
import { useNotebooks } from "@/components/dashboard/notebooks-provider";
import { PageHeading } from "@/components/dashboard/ui/page-heading";
import { Button } from "@/components/dashboard/ui/button";
import { NotebookActions } from "@/components/dashboard/notebook-actions";
import { NotebookBulkLifecycleDialog } from "@/components/dashboard/notebook-bulk-lifecycle";
import { SearchField } from "@/components/dashboard/ui/search-field";
import {
  NotebookDropTarget,
  useWorkspaceDrag,
} from "@/components/dashboard/memory-drag";

export default function ProjectsPage() {
  const active = useNotebooks();
  const drag = useWorkspaceDrag();
  const cache = useWorkspaceCache();
  const archived = useSearchParams().get("status") === "archived";
  const archiveQuery = useQuery({
    ...cache.notebookCatalog("archived"),
    enabled: archived,
  });
  const projects = archived
    ? (archiveQuery.data?.items ?? [])
    : active.projects;
  const loading = archived ? archiveQuery.isPending : active.loading;
  const error = archived
    ? archiveQuery.error
      ? errorMessage(archiveQuery.error)
      : ""
    : active.error;
  const reload = archived ? () => void archiveQuery.refetch() : active.reload;
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [bulk, setBulk] = useState<{
    action: "restore" | "delete";
    projects: Project[];
  } | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState<string | null>(null);
  const matches = projects.filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selectedArchived = archived
    ? matches.filter((project) => checked.includes(project.id))
    : [];
  const allSelected =
    archived &&
    matches.length > 0 &&
    matches.slice(0, 50).every((project) => checked.includes(project.id));
  return (
    <>
      <PageHeading
        title={archived ? "Archived notebooks" : "Notebooks"}
        actions={
          <>
            <Button variant="secondary" onClick={() => active.openOrganizer()}>
              Organize
            </Button>
            <Button onClick={() => setAction({ mode: "create" })}>
              <Plus size={16} />
              New notebook
            </Button>
          </>
        }
      />
      <nav className="notebook-status-nav" aria-label="Notebook status">
        <Link
          href="/app/projects"
          aria-current={!archived ? "page" : undefined}
        >
          Active
        </Link>
        <Link
          href="/app/projects?status=archived"
          aria-current={archived ? "page" : undefined}
        >
          Archived
        </Link>
      </nav>
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      {projects.length > 0 && (
        <div className="project-toolbar">
          <SearchField
            className="project-search"
            label="Find a notebook"
            value={query}
            onChange={setQuery}
            placeholder="Find a notebook…"
          />
          <span>
            {query.trim()
              ? `${matches.length} of ${projects.length} notebooks`
              : `${projects.length} ${projects.length === 1 ? "notebook" : "notebooks"}`}
          </span>
        </div>
      )}
      {error && (
        <LoadError
          title="Your notebooks couldn’t load"
          message={error}
          retry={reload}
        />
      )}
      {loading ? (
        <p role="status" className="library-loading">
          Opening your notebooks…
        </p>
      ) : !matches.length && !error ? (
        <div className="app-empty">
          <Folder className="mx-auto mb-4" size={28} strokeWidth={1.4} />
          <h2 className="font-editorial text-3xl">
            {query
              ? "No matching notebooks."
              : archived
                ? "No archived notebooks."
                : "Give your ideas a home."}
          </h2>
          <p>
            {query
              ? "Try another name."
              : archived
                ? "Archived notebooks appear here with Restore and Delete actions."
                : "Start a notebook for a project, a topic, or whatever’s on your mind."}
          </p>
          {!query && !archived && (
            <Button
              className="mt-6"
              onClick={() => setAction({ mode: "create" })}
            >
              Create your first notebook
            </Button>
          )}
        </div>
      ) : archived ? (
        <>
          {matches.length > 0 && (
            <div
              className="library-selection-header"
              data-active={selectedArchived.length > 0 || undefined}
            >
              <label className="select-loaded">
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Select archived notebooks"
                  onChange={(event) =>
                    setChecked(
                      event.target.checked
                        ? matches.slice(0, 50).map((project) => project.id)
                        : [],
                    )
                  }
                />
                <span role="status" aria-live="polite" aria-atomic="true">
                  {selectedArchived.length > 0
                    ? `${selectedArchived.length} selected`
                    : "Select archived notebooks"}
                </span>
              </label>
              {selectedArchived.length > 0 && (
                <div
                  className="selection-toolbar"
                  role="group"
                  aria-label="Selected notebooks"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setBulk({
                        action: "restore",
                        projects: selectedArchived,
                      })
                    }
                    aria-label="Restore"
                    title="Restore selected notebooks"
                  >
                    <ArchiveRestore size={16} />
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      setBulk({ action: "delete", projects: selectedArchived })
                    }
                    aria-label="Delete"
                    title="Delete selected notebooks"
                  >
                    <Trash2 size={16} />
                    <span>Delete</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChecked([])}
                    aria-label="Clear selection"
                    title="Clear selection (Esc)"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
          <ul
            className="notebook-archive-list"
            aria-label="Archived notebooks"
            onKeyDown={(event) => {
              if (
                event.key === "Escape" &&
                !event.defaultPrevented &&
                selectedArchived.length > 0 &&
                !document.querySelector(
                  "[popover]:popover-open, [role=listbox]",
                )
              ) {
                event.preventDefault();
                setChecked([]);
              }
            }}
          >
            {matches.map((project) => (
              <li key={project.id}>
                <label className="row-checkbox">
                  <input
                    type="checkbox"
                    aria-label={`Select ${project.name}`}
                    checked={checked.includes(project.id)}
                    onChange={() =>
                      setChecked((current) =>
                        current.includes(project.id)
                          ? current.filter((id) => id !== project.id)
                          : current.length < 50
                            ? [...current, project.id]
                            : current,
                      )
                    }
                  />
                </label>
                <span>{project.name}</span>
                <ActionMenu label={`Notebook actions for ${project.name}`}>
                  <NotebookActions project={project} onAction={setAction} />
                </ActionMenu>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <section
          className="notebook-manager"
          aria-label="Notebook organization"
        >
          {drag.active?.kind === "notebook" && (
            <NotebookDropTarget projectId={null} name="Top level" root />
          )}
          <NotebookTree
            projects={projects}
            query={query}
            defaultExpanded
            actions={(project) => (
              <ActionMenu label={`More actions for ${project.name}`}>
                <NotebookActions
                  project={project}
                  onAction={setAction}
                  onShare={() => setSharing(project.id)}
                />
              </ActionMenu>
            )}
          />
        </section>
      )}
      {action && (
        <NotebookDialog
          action={action}
          close={() => setAction(null)}
          onSaved={() => setNotice("Notebook saved.")}
        />
      )}
      {bulk && (
        <NotebookBulkLifecycleDialog
          projects={bulk.projects}
          action={bulk.action}
          close={() => setBulk(null)}
          onDone={(summary) => {
            // The rows already left optimistically; only clear the selection.
            if (archived)
              setChecked((current) =>
                current.filter(
                  (id) => !bulk.projects.some((project) => project.id === id),
                ),
              );
            setBulk(null);
            setNotice(summary);
          }}
        />
      )}
      {sharing && (
        <ShareDialog
          target={{ kind: "notebook", id: sharing }}
          close={() => setSharing(null)}
        />
      )}
    </>
  );
}
