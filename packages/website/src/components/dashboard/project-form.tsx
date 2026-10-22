"use client";
import { useRef, useState } from "react";
import {
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import { useDialogBusy } from "./dialog";
import { NotebookSelect } from "./notebook-select";
import { useNotebooks } from "./notebooks-provider";
import { LoadError } from "./load-error";
import { useWorkspaceApi } from "./workspace-cache";
import { notebookOptions, notebookPath } from "@/lib/notebooks";

export function ProjectForm({
  mode = "create",
  project,
  parentId: initialParent,
  done,
  cancel,
}: {
  mode?: "create" | "rename" | "move";
  project?: Project;
  parentId?: string;
  done: (project: Project) => void;
  cancel: () => void;
}) {
  const api = useWorkspaceApi();
  const [base, setBase] = useState(project);
  const [name, setName] = useState(project?.name ?? "");
  const [identity, setIdentity] = useState(project?.identity ?? "");
  const [parentId, setParentId] = useState(
    project?.parentId ?? initialParent ?? "",
  );
  const notebooks = useNotebooks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const generated = useRef("");
  const setDialogBusy = useDialogBusy();
  const current = notebooks.projects.find((item) => item.id === project?.id);
  const validParent =
    !parentId ||
    notebookOptions(notebooks.projects, base?.id).some(
      (option) => option.value === parentId,
    );
  const changed =
    !base ||
    (mode === "rename"
      ? name.trim() !== base.name
      : parentId !== (base.parentId ?? ""));
  const unavailable =
    !!base && !notebooks.loading && !notebooks.error && !current;
  const disabled =
    busy ||
    conflict ||
    unavailable ||
    !changed ||
    !name.trim() ||
    !validParent ||
    notebooks.loading ||
    !!notebooks.error;
  return (
    <form
      className="app-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled) return;
        setBusy(true);
        setDialogBusy(true);
        setError("");
        generated.current ||= `workspace:${crypto.randomUUID()}`;
        try {
          const saved = await api<Project>(
            base ? `/projects/${base.id}` : "/projects",
            {
              name: mode === "move" && base ? base.name : name.trim(),
              identity:
                base?.identity ?? (identity.trim() || generated.current),
              parentId:
                mode === "rename" && base ? base.parentId : parentId || null,
              ...(base ? { expectedVersion: base.version } : {}),
            },
            base ? "PATCH" : "POST",
          );
          done(saved);
        } catch (e) {
          setError(errorMessage(e));
          if (e instanceof DashboardApiError && e.code === "version_conflict") {
            setConflict(true);
            notebooks.reload();
          }
        } finally {
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      {mode !== "move" ? (
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
      ) : (
        <p>
          Move <strong>{base?.name}</strong>. Its sub-notebooks move with it.
        </p>
      )}
      {mode !== "rename" ? (
        <NotebookSelect
          autoFocus={mode === "move"}
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
      ) : (
        <p className="text-sm text-muted">
          In{" "}
          {base?.parentId
            ? notebookPath(notebooks.projects, base.parentId)
                .map((item) => item.name)
                .join(" / ")
            : "Top level"}
        </p>
      )}
      {notebooks.error && (
        <LoadError message={notebooks.error} retry={notebooks.reload} />
      )}
      <p className="text-xs leading-6 text-muted">
        Nest notebooks to keep related ideas together. Each notebook keeps its
        own agent access.
      </p>
      {!base && (
        <p className="text-sm leading-7 text-muted">
          A home for related notes, decisions, and work in progress. You can
          start with just a name.
        </p>
      )}
      {mode === "create" && (
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
      )}
      {!validParent && (
        <p className="app-error" role="alert">
          Choose an available destination. A notebook cannot be moved into
          itself or its sub-notebooks.
        </p>
      )}
      {unavailable && (
        <p className="app-error" role="alert">
          This notebook is no longer available.
        </p>
      )}
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      {conflict && current && !notebooks.loading && (
        <section className="app-notice">
          <p>
            The current notebook is “{current.name}” in{" "}
            {current.parentId
              ? notebookPath(notebooks.projects, current.parentId)
                  .map((item) => item.name)
                  .join(" / ")
              : "Top level"}
            . Your changes are still here.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setBase(current);
              if (mode === "rename") setParentId(current.parentId ?? "");
              else setName(current.name);
              setConflict(false);
              setError("");
            }}
          >
            Use this version
          </button>
        </section>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </button>
        <button disabled={disabled} className="app-button">
          {busy
            ? "Saving…"
            : mode === "move"
              ? "Move notebook"
              : mode === "rename"
                ? "Rename notebook"
                : "Create notebook"}
        </button>
      </div>
    </form>
  );
}
