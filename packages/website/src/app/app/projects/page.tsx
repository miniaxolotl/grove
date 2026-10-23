"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@/lib/dashboard-api";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "@/components/dashboard/workspace-cache";
import { ActionMenu } from "@/components/dashboard/ui/action-menu";
import { Folder, Plus } from "lucide-react";
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
import { SearchField } from "@/components/dashboard/ui/search-field";
import { NotebookDropTarget } from "@/components/dashboard/memory-drag";

export default function ProjectsPage() {
  const active = useNotebooks();
  const cache = useWorkspaceCache();
  const archived = useSearchParams().get("status") === "archived";
  const archiveQuery = useQuery({
    ...cache.resource<Project[]>("/projects?status=archived"),
    enabled: archived,
  });
  const projects = archived ? (archiveQuery.data ?? []) : active.projects;
  const loading = archived ? archiveQuery.isPending : active.loading;
  const error = archived
    ? archiveQuery.error
      ? errorMessage(archiveQuery.error)
      : ""
    : active.error;
  const reload = archived ? () => void archiveQuery.refetch() : active.reload;
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState<string | null>(null);
  const matches = projects.filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <PageHeading
        title={archived ? "Archived notebooks" : "Notebooks"}
        description={`${projects.length} notebooks`}
        actions={
          <Button onClick={() => setAction({ mode: "create" })}>
            <Plus size={16} />
            New notebook
          </Button>
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
            {matches.length} {matches.length === 1 ? "notebook" : "notebooks"}
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
        <ul className="notebook-archive-list" aria-label="Archived notebooks">
          {matches.map((project) => (
            <li key={project.id}>
              <span>{project.name}</span>
              <ActionMenu label={`Notebook actions for ${project.name}`}>
                <NotebookActions project={project} onAction={setAction} />
              </ActionMenu>
            </li>
          ))}
        </ul>
      ) : (
        <section
          className="notebook-manager"
          aria-label="Notebook organization"
        >
          <NotebookDropTarget projectId={null} name="Top level" root />
          <NotebookTree
            projects={projects}
            query={query}
            defaultExpanded
            actions={(project) => (
              <NotebookActions
                compact
                project={project}
                onAction={setAction}
                onShare={() => setSharing(project.id)}
              />
            )}
          />
          <p className="notebook-organization-hint">
            Drag notebooks to nest them. Drop at Top level to unnest.
          </p>
        </section>
      )}
      {action && (
        <NotebookDialog
          action={action}
          close={() => setAction(null)}
          onSaved={() => setNotice("Notebook saved.")}
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
