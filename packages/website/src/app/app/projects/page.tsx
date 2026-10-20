"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Folder, Plus, ArrowUpRight, Search, Pencil } from "lucide-react";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { Dialog } from "@/components/dashboard/dialog";
import { LoadError } from "@/components/dashboard/load-error";
import { ProjectForm } from "@/components/dashboard/project-form";

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
  const visible = projects.filter((project) =>
    project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <div className="app-page-heading">
        <div>
          <h1>Projects</h1>
          <p>
            Keep the memories, decisions, and handoffs for each piece of work
            together.
          </p>
        </div>
        <button className="app-button" onClick={() => setSelected("new")}>
          <Plus size={16} />
          Add project
        </button>
      </div>
      {projects.length > 0 && (
        <div className="project-search app-search">
          <Search size={18} />
          <input
            aria-label="Filter projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a project…"
          />
        </div>
      )}
      {error && <LoadError message={error} retry={reload} />}
      {loading ? (
        <p role="status" className="library-loading">
          Loading projects…
        </p>
      ) : !visible.length && !error ? (
        <div className="app-empty">
          <Folder className="mx-auto mb-4" size={28} strokeWidth={1.4} />
          <h2 className="font-editorial text-3xl">
            {query ? "No matching projects." : "Give your work a home."}
          </h2>
          <p>
            {query
              ? "Try another name."
              : "Create a project for whatever you’re working on. Your agents can use the same project, too."}
          </p>
          {!query && (
            <button
              className="app-button mt-6"
              onClick={() => setSelected("new")}
            >
              Create your first project
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
                  <span>Memories, context, and handoffs</span>
                </span>
                <ArrowUpRight size={17} />
              </Link>
              <button
                className="app-icon"
                aria-label={`Rename ${project.name}`}
                onClick={() => setSelected(project)}
              >
                <Pencil size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <Dialog
          title={selected === "new" ? "Create a project" : "Rename project"}
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
