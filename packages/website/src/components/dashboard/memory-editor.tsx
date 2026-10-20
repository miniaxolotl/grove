"use client";
import { useRef, useState } from "react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { MarkdownEditor } from "./markdown-editor";
import { useDialogBusy } from "./dialog";

export function MemoryEditor({
  memory,
  projects,
  projectId: defaultProject = null,
  initialKind = "fact",
  done,
  cancel,
}: {
  memory?: Memory;
  projects: Project[];
  projectId?: string | null;
  initialKind?: Memory["kind"];
  done: (memory: Memory) => void;
  cancel: () => void;
}) {
  const [content, setContent] = useState(memory?.content ?? "");
  const [kind, setKind] = useState(memory?.kind ?? initialKind);
  const [autoKind, setAutoKind] = useState(memory?.autoKind ?? !memory);
  const [projectId, setProjectId] = useState(
    memory?.projectId ?? defaultProject ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setDialogBusy = useDialogBusy();
  const task = useRef(memory?.taskId ?? "");
  const pending = useRef<{ fingerprint: string; operationId: string } | null>(
    null,
  );
  return (
    <form
      className="app-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !content.trim() || content.length > 6000) return;
        setBusy(true);
        setDialogBusy(true);
        setError("");
        if (kind === "handoff" && !task.current)
          task.current = `task-${crypto.randomUUID()}`;
        const input = {
          content,
          kind,
          autoKind: kind !== "handoff" && autoKind,
          projectId: projectId || null,
          ...(kind === "handoff" ? { taskId: task.current } : {}),
          source: memory?.source ?? { agent: "website" },
          ...(memory ? { id: memory.id, expectedVersion: memory.version } : {}),
        };
        const fingerprint = JSON.stringify(input);
        if (pending.current?.fingerprint !== fingerprint)
          pending.current = { fingerprint, operationId: crypto.randomUUID() };
        try {
          done(
            await api<Memory>("/memories", {
              ...input,
              operationId: pending.current.operationId,
            }),
          );
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="editor-fields" aria-busy={busy}>
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder={
            kind === "handoff"
              ? "# Task name\n\n## Progress\nWhat’s done so far?\n\n## Next steps\n- [ ] What should happen next?"
              : "A useful preference, decision, fact, or solution…"
          }
        />
        <div className="grid grid-cols-2 gap-4">
          <label>
            Kind
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Memory["kind"]);
                setAutoKind(false);
              }}
            >
              {(
                [
                  "preference",
                  "fact",
                  "decision",
                  "solution",
                  "handoff",
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {value === "handoff"
                    ? "Task handoff"
                    : value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Personal</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {kind === "handoff" ? (
          <p className="text-sm leading-7 text-muted">
            A handoff keeps a task’s progress together across sessions. Grove
            creates its reference for you. Active for 30 days; removed after 90
            days.
          </p>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={autoKind}
              onChange={(e) => setAutoKind(e.target.checked)}
            />
            Organize the kind automatically
          </label>
        )}
        {error && (
          <p role="alert" className="app-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy || !content.trim() || content.length > 6000}
            className="app-button"
          >
            {busy ? "Saving…" : "Save memory"}
          </button>
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
