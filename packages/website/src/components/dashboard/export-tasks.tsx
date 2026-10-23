"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { Task } from "@lib/shared/jobs";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { IconButton } from "./ui/button";

const active = (task: Task) =>
  task.status === "pending" || task.status === "running";
const status = (task: Task) => {
  if (task.downloadable) return "Ready";
  if (task.status === "cancelled") return "Cancelled";
  if (task.error === "export_changed") return "Notes changed · retry";
  if (task.error === "export_expired") return "Expired · retry";
  if (task.status === "failed") return "Couldn’t export · retry";
  return task.processed
    ? `${task.processed.toLocaleString()} records`
    : "Queued";
};

export function ExportTasks({ projectId }: { projectId?: string }) {
  const cache = useWorkspaceCache();
  const path = projectId ? `/tasks?projectId=${projectId}` : "/tasks";
  const query = useQuery({
    ...cache.resource<Task[]>(path),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.some(active) ? 2000 : false),
    refetchIntervalInBackground: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [descendants, setDescendants] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const request = useRef<{
    id: string;
    projectId?: string;
    includeDescendants: boolean;
    includeMedia?: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const exports = query.data?.filter((task) => task.kind === "export") ?? [];
  const running = exports.find(active);
  async function mutate(id?: string, action?: "cancel" | "retry") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(id ?? "new");
    setError("");
    try {
      if (id && action) await cache.api(`/tasks/${id}/${action}`, {});
      else {
        request.current ??= {
          id: crypto.randomUUID(),
          projectId,
          includeDescendants: descendants,
          ...(includeMedia ? { includeMedia: true } : {}),
        };
        setSubmitted(true);
        await cache.api("/exports", request.current);
        request.current = null;
        setSubmitted(false);
      }
      await query.refetch();
      heading.current?.focus({ preventScroll: true });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }
  return (
    <section className="export-tasks" aria-label="Exports">
      <div className="flex items-center justify-between gap-3">
        <h2
          ref={heading}
          tabIndex={-1}
          className={
            projectId ? "text-sm font-medium" : "font-editorial text-2xl"
          }
        >
          {projectId ? "Notes and version history" : "Export your data"}
        </h2>
        <IconButton
          label="Prepare export"
          disabled={!!busy || exports.some(active) || query.isPending}
          onClick={() => void mutate()}
        >
          {busy === "new" ? (
            <LoaderCircle size={18} className="motion-safe:animate-spin" />
          ) : (
            <Download size={18} />
          )}
        </IconButton>
      </div>
      <p className="mt-2 text-sm text-muted">
        {projectId
          ? "NDJSON"
          : "Notebooks, notes, history and conversations · NDJSON"}
      </p>
      {projectId && (
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={running?.scope?.includeDescendants ?? descendants}
            disabled={!!busy || submitted || !!running}
            onChange={(event) => setDescendants(event.target.checked)}
          />
          Include sub-notebooks
        </label>
      )}
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeMedia}
          disabled={!!busy || submitted || !!running}
          onChange={(event) => setIncludeMedia(event.target.checked)}
        />
        Include original media (larger NDJSON download)
      </label>
      {(error || query.isError) && (
        <div className="mt-3 flex items-center gap-2">
          <p className="app-error" role="alert">
            {error || "Exports couldn’t load."}
          </p>
          {query.isError && (
            <IconButton
              label="Reload exports"
              onClick={() => void query.refetch()}
            >
              <RotateCcw size={16} />
            </IconButton>
          )}
        </div>
      )}
      {query.isPending && (
        <p className="mt-4 text-sm text-muted" role="status">
          Loading exports…
        </p>
      )}
      <ul
        className="mt-4 divide-y divide-line"
        aria-live="polite"
        aria-relevant="text additions"
      >
        {exports.slice(0, 3).map((task) => (
          <li key={task.id} className="flex min-h-14 items-center gap-3 py-2">
            {active(task) ? (
              <LoaderCircle
                aria-hidden
                size={16}
                className="shrink-0 motion-safe:animate-spin"
              />
            ) : task.downloadable ? (
              <Check aria-hidden size={16} className="shrink-0" />
            ) : (
              <span aria-hidden className="w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm">{status(task)}</p>
              <p className="text-xs text-muted">
                {task.scope?.projectId &&
                  (task.scope.includeDescendants
                    ? "Notebook + sub-notebooks · "
                    : "Notebook · ")}
                <time dateTime={task.createdAt}>
                  {new Date(task.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </p>
            </div>
            {task.downloadable ? (
              <a
                className="app-icon"
                href={`/api/grove/tasks/${task.id}/download`}
                download
                aria-label="Download export"
                title="Download export"
              >
                <Download size={16} />
              </a>
            ) : active(task) ? (
              <IconButton
                label="Cancel export"
                disabled={!!busy}
                onClick={() => void mutate(task.id, "cancel")}
              >
                <X size={16} />
              </IconButton>
            ) : (
              <IconButton
                label="Retry export"
                disabled={!!busy || exports.some(active)}
                onClick={() => void mutate(task.id, "retry")}
              >
                <RotateCcw size={16} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
