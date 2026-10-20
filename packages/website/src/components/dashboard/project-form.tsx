"use client";
import { useRef, useState } from "react";
import {
  api,
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import { useDialogBusy } from "./dialog";
import { NotebookSelect } from "./notebook-select";
import { useNotebooks } from "./notebooks-provider";
import { LoadError } from "./load-error";

export function ProjectForm({
  project,
  parentId: initialParent,
  done,
}: {
  project?: Project;
  parentId?: string;
  done: (project: Project) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [identity, setIdentity] = useState(project?.identity ?? "");
  const [parentId, setParentId] = useState(
    project?.parentId ?? initialParent ?? "",
  );
  const notebooks = useNotebooks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generated = useRef("");
  const setDialogBusy = useDialogBusy();
  return (
    <form
      className="app-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setDialogBusy(true);
        setError("");
        generated.current ||= `workspace:${crypto.randomUUID()}`;
        try {
          const saved = await api<Project>(
            project ? `/projects/${project.id}` : "/projects",
            {
              name: name.trim(),
              identity: identity.trim() || generated.current,
              parentId: parentId || null,
              ...(project?.version ? { expectedVersion: project.version } : {}),
            },
            project ? "PATCH" : "POST",
          );
          notebooks.saved(saved);
          done(saved);
        } catch (e) {
          setError(errorMessage(e));
          if (e instanceof DashboardApiError && e.code === "version_conflict")
            notebooks.reload();
        } finally {
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      <label>
        Notebook name
        <input
          autoFocus
          disabled={busy}
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="A new idea"
        />
      </label>
      <NotebookSelect
        label="Parent notebook"
        value={parentId}
        onValueChange={setParentId}
        projects={notebooks.projects}
        exclude={project?.id}
        leading={[
          {
            value: "",
            label: "Top level",
            description: "Keep this notebook at the root",
          },
        ]}
        disabled={busy || notebooks.loading || !!notebooks.error}
      />
      {notebooks.error && (
        <LoadError message={notebooks.error} retry={notebooks.reload} />
      )}
      <p className="text-xs leading-6 text-muted">
        Nest notebooks to keep related ideas together. Each notebook keeps its
        own agent access.
      </p>
      {!project && (
        <p className="text-sm leading-7 text-muted">
          A home for related notes, decisions, and work in progress. You can
          start with just a name.
        </p>
      )}
      <details className="agent-details">
        <summary>
          {project ? "Agent details" : "Link a repository (optional)"}
        </summary>
        <label>
          Repository identity
          <input
            disabled={!!project || busy}
            maxLength={500}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="git:github.com/owner/repository"
          />
        </label>
        <p>
          Agents use this reference to recognize the same project across
          repositories and worktrees. Grove creates one automatically when you
          leave it blank.
        </p>
      </details>
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={
          busy || !name.trim() || notebooks.loading || !!notebooks.error
        }
        className="app-button"
      >
        {busy ? "Saving…" : "Save notebook"}
      </button>
    </form>
  );
}
