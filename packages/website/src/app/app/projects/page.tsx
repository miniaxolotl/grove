"use client";
import { useEffect, useState } from "react";
import { Folder, Plus } from "lucide-react";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { Dialog } from "@/components/dashboard/dialog";
import { LoadError } from "@/components/dashboard/load-error";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Project | "new" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = () => {
    setError("");
    setLoading(true);
    setRefresh((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    api<Project[]>("/projects", undefined, undefined, controller.signal)
      .then(setProjects)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  return (
    <>
      <div className="app-page-heading">
        <div>
          <p className="eyebrow">A PLACE FOR EACH THREAD</p>
          <h1>
            Your projects<span className="text-leaf">.</span>
          </h1>
          <p>
            One identity per repository, shared across agents and worktrees.
          </p>
        </div>
        <button className="app-button" onClick={() => setSelected("new")}>
          <Plus size={16} />
          Add project
        </button>
      </div>
      {error && <LoadError message={error} retry={reload} />}
      {loading ? (
        <p role="status">Loading projects…</p>
      ) : !projects.length && !error ? (
        <div className="app-empty">
          <Folder className="mx-auto mb-4" size={28} strokeWidth={1.3} />
          <h2 className="font-editorial text-3xl">Give your work a home.</h2>
          <p className="mt-3 text-sm text-muted">
            Create a project here, or let Grove setup identify your Git
            repository.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li
              key={project.id}
              className="app-panel flex flex-wrap items-center gap-5"
            >
              <Folder size={22} strokeWidth={1.4} />
              <div className="min-w-0 flex-1">
                <h2 className="font-medium">{project.name}</h2>
                <p className="mt-2 break-all font-mono text-xs text-muted">
                  {project.identity}
                </p>
                <p className="mt-2 break-all text-[11px] text-muted">
                  Project ID: {project.id}
                </p>
              </div>
              <button
                className="app-button secondary"
                onClick={() => setSelected(project)}
              >
                Rename
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

function ProjectForm({
  project,
  done,
}: {
  project?: Project;
  done: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [identity, setIdentity] = useState(project?.identity ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="app-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(
            project ? `/projects/${project.id}` : "/projects",
            { name, identity },
            project ? "PATCH" : "POST",
          );
          done();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Stable repository identity
        <input
          required
          disabled={!!project}
          maxLength={500}
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder="git:github.com/owner/repository"
        />
        <small className="font-normal text-muted">
          Use the same identity in every agent. Grove strips Git credentials and
          .git suffixes during setup.
        </small>
      </label>
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} className="app-button">
        {busy ? "Saving…" : "Save project"}
      </button>
    </form>
  );
}
