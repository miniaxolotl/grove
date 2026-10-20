"use client";
import { useState } from "react";
import { Folder, Plus, Pencil, FolderInput } from "lucide-react";
import { LoadError } from "@/components/dashboard/load-error";
import {
  NotebookDialog,
  type NotebookAction,
} from "@/components/dashboard/notebook-dialog";
import { NotebookTree } from "@/components/dashboard/notebook-tree";
import { useNotebooks } from "@/components/dashboard/notebooks-provider";
import { PageHeading } from "@/components/dashboard/ui/page-heading";
import { Button, IconButton } from "@/components/dashboard/ui/button";
import { SearchField } from "@/components/dashboard/ui/search-field";
import { NotebookDropTarget } from "@/components/dashboard/memory-drag";

export default function ProjectsPage() {
  const { projects, loading, error, reload } = useNotebooks();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [notice, setNotice] = useState("");
  const matches = projects.filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="Notebooks"
        description={`${projects.length} notebooks`}
        actions={
          <Button onClick={() => setAction({})}>
            <Plus size={16} />
            New notebook
          </Button>
        }
      />
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
      {error && <LoadError message={error} retry={reload} />}
      {loading ? (
        <p role="status" className="library-loading">
          Opening your notebooks…
        </p>
      ) : !matches.length && !error ? (
        <div className="app-empty">
          <Folder className="mx-auto mb-4" size={28} strokeWidth={1.4} />
          <h2 className="font-editorial text-3xl">
            {query ? "No matching notebooks." : "Give your ideas a home."}
          </h2>
          <p>
            {query
              ? "Try another name."
              : "Start a notebook for a project, a topic, or whatever’s on your mind."}
          </p>
          {!query && (
            <Button className="mt-6" onClick={() => setAction({})}>
              Create your first notebook
            </Button>
          )}
        </div>
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
              <>
                <IconButton
                  label={`Add sub-notebook to ${project.name}`}
                  onClick={() => setAction({ parentId: project.id })}
                >
                  <Plus size={16} />
                </IconButton>
                <IconButton
                  label={`Rename ${project.name}`}
                  onClick={() => setAction({ project })}
                >
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label={`Move ${project.name}`}
                  onClick={() => setAction({ project, move: true })}
                >
                  <FolderInput size={16} />
                </IconButton>
              </>
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
    </>
  );
}
