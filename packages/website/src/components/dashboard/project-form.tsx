"use client";
import { useRef, useState } from "react";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { useDialogBusy } from "./dialog";

export function ProjectForm({
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
          await api(
            project ? `/projects/${project.id}` : "/projects",
            {
              name: name.trim(),
              identity: identity.trim() || generated.current,
            },
            project ? "PATCH" : "POST",
          );
          done();
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      <label>
        Project name
        <input
          autoFocus
          disabled={busy}
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Website redesign"
        />
      </label>
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
      <button disabled={busy || !name.trim()} className="app-button">
        {busy ? "Saving…" : "Save project"}
      </button>
    </form>
  );
}
