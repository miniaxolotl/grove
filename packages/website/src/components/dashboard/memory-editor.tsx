"use client";
import { useRef, useState } from "react";
import type { Memory } from "@lib/shared/contracts";
import {
  api,
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import { MarkdownEditor } from "./markdown-editor";
import { useDialogBusy } from "./dialog";
import { Button } from "./ui/button";
import { RevisionCompare } from "./revision-compare";

export function MemoryEditor({
  memory,
  projects,
  projectId: defaultProject = null,
  initialKind = "fact",
  initialContent = "",
  guidance,
  personal = false,
  done,
  cancel,
}: {
  memory?: Memory;
  projects: Project[];
  projectId?: string | null;
  initialKind?: Memory["kind"];
  initialContent?: string;
  guidance?: string;
  personal?: boolean;
  done: (memory: Memory) => void;
  cancel: () => void;
}) {
  const [content, setContent] = useState(memory?.content ?? initialContent);
  const [base, setBase] = useState(memory);
  const [latest, setLatest] = useState<Memory>();
  const [kind, setKind] = useState(memory?.kind ?? initialKind);
  const [retention, setRetention] = useState(
    String(
      memory
        ? (memory.retentionDays ?? (memory.expiresAt ? 30 : "permanent"))
        : initialKind === "handoff"
          ? 30
          : "permanent",
    ),
  );
  const [autoKind, setAutoKind] = useState(
    memory?.autoKind ?? (!memory && !personal),
  );
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
        if (busy || latest || !content.trim() || content.length > 6000) return;
        setBusy(true);
        setDialogBusy(true);
        setError("");
        if (kind === "handoff" && !task.current)
          task.current = `task-${crypto.randomUUID()}`;
        const input = {
          content,
          kind,
          retentionDays: retention === "permanent" ? null : Number(retention),
          autoKind: kind !== "handoff" && autoKind,
          projectId: projectId || null,
          ...(kind === "handoff" ? { taskId: task.current } : {}),
          source: base?.source ?? { agent: "website" },
          ...(base ? { id: base.id, expectedVersion: base.version } : {}),
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
          if (
            e instanceof DashboardApiError &&
            e.code === "version_conflict" &&
            base
          ) {
            try {
              setLatest(await api<Memory>(`/memories/${base.id}`));
            } catch {
              /* Keep the original draft and error if the latest copy is unavailable. */
            }
          }
        } finally {
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="editor-fields" aria-busy={busy}>
        {latest && (
          <section className="note-conflict" aria-label="Review newer version">
            <h2>This note has a newer version.</h2>
            <p>
              Your draft is still here. Compare the two, then choose what to
              keep.
            </p>
            <RevisionCompare
              before={latest.content}
              after={content}
              beforeLabel={`Saved version ${latest.version}`}
              afterLabel="Your draft"
            />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setBase(latest);
                  setContent(latest.content);
                  setKind(latest.kind);
                  setProjectId(latest.projectId ?? "");
                  setAutoKind(latest.autoKind ?? false);
                  setRetention(
                    String(
                      latest.retentionDays ??
                        (latest.expiresAt ? 30 : "permanent"),
                    ),
                  );
                  task.current = latest.taskId ?? "";
                  setLatest(undefined);
                  setError("");
                }}
              >
                Use saved version
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setBase(latest);
                  setLatest(undefined);
                  setError("");
                }}
              >
                Keep my draft to replace it
              </Button>
            </div>
            <p>
              The next save creates a new version. Earlier versions stay in
              History.
            </p>
          </section>
        )}
        {guidance && <p className="editor-guidance">{guidance}</p>}
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder={
            kind === "handoff"
              ? "# Task name\n\n## Progress\nWhat’s done so far?\n\n## Next steps\n- [ ] What should happen next?"
              : "Start writing…"
          }
        />
        {!personal && (
          <label>
            Notebook
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Personal</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <details className="note-options">
          <summary>Note options</summary>
          <div className="grid grid-cols-2 gap-4">
            <label>
              Note type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Memory["kind"]);
                  setAutoKind(false);
                  if (!memory && e.target.value === "handoff")
                    setRetention("30");
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
                      ? "Progress note"
                      : value === "fact"
                        ? "Note"
                        : value === "solution"
                          ? "How-to"
                          : value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Keep this note
            <select
              value={retention === "permanent" ? "permanent" : "ephemeral"}
              onChange={(e) =>
                setRetention(
                  e.target.value === "permanent" ? "permanent" : "30",
                )
              }
            >
              <option value="permanent">Until I remove it</option>
              <option value="ephemeral">For a limited time</option>
            </select>
          </label>
          {retention !== "permanent" && (
            <label>
              Expires after
              <select
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              >
                {[...new Set([1, 7, 30, 90, Number(retention)])]
                  .sort((a, b) => a - b)
                  .map((days) => (
                    <option key={days} value={days}>
                      {days} {days === 1 ? "day" : "days"}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p className="text-xs leading-6 text-muted">
            {retention === "permanent"
              ? "Yours to keep. Archive or delete it whenever you like."
              : "When it expires, this note moves out of search. You have 60 days to restore it before it’s deleted."}
          </p>
          {personal && (
            <p className="text-sm leading-7 text-muted">
              Saved in Personal. You choose which agents can read it.
            </p>
          )}
          {kind === "handoff" ? (
            <p className="text-sm leading-7 text-muted">
              Keep what’s done and what comes next together, for you and your
              agents.
            </p>
          ) : (
            <label className="check">
              <input
                type="checkbox"
                checked={autoKind}
                onChange={(e) => setAutoKind(e.target.checked)}
              />
              Let Grove choose the note type
            </label>
          )}
        </details>
        {error && (
          <p role="alert" className="app-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={
              busy || !!latest || !content.trim() || content.length > 6000
            }
          >
            {busy ? "Saving…" : "Save note"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
