"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Folder, Plus, ArrowRight, Pencil } from "lucide-react";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { Dialog } from "@/components/dashboard/dialog";
import { LoadError } from "@/components/dashboard/load-error";
import { ProjectForm } from "@/components/dashboard/project-form";
import { PageHeading } from "@/components/dashboard/ui/page-heading";
import { Button, IconButton } from "@/components/dashboard/ui/button";
import { SearchField } from "@/components/dashboard/ui/search-field";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Project | "new" | null>(null);
  const [refresh, setRefresh] = useState(0);
  function reload() {
    setLoading(true);
    setError("");
    setRefresh((v) => v + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    api<Project[]>("/projects", undefined, undefined, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setProjects(list);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  const visible = projects
    .filter((project) =>
      project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeading
        title="Notebooks"
        description="Give your ideas a place to grow."
        actions={
          <Button onClick={() => setSelected("new")}>
            <Plus size={16} />
            New notebook
          </Button>
        }
      />
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
            {visible.length} {visible.length === 1 ? "notebook" : "notebooks"}
          </span>
        </div>
      )}
      {error && <LoadError message={error} retry={reload} />}
      {loading ? (
        <p role="status" className="library-loading">
          Opening your notebooks…
        </p>
      ) : !visible.length && !error ? (
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
            <button
              className="app-button mt-6"
              onClick={() => setSelected("new")}
            >
              Create your first notebook
            </button>
          )}
        </div>
      ) : (
        <ul className="project-list">
          {visible.map((project) => (
            <li key={project.id}>
              <Link
                className="project-link"
                href={`/app/projects/${project.id}`}
              >
                <span className="project-symbol">
                  <Folder size={22} strokeWidth={1.4} />
                </span>
                <span>
                  <strong>{project.name}</strong>
                </span>
                <ArrowRight size={17} />
              </Link>
              <IconButton
                label={`Rename ${project.name}`}
                onClick={() => setSelected(project)}
              >
                <Pencil size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <Dialog
          title={selected === "new" ? "New notebook" : "Rename notebook"}
          close={() => setSelected(null)}
        >
          <ProjectForm
            project={selected === "new" ? undefined : selected}
            done={() => {
              setSelected(null);
              reload();
            }}
          />
        </Dialog>
      )}
    </>
  );
}
