"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { Task } from "@lib/shared/jobs";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { Button, IconButton } from "./ui/button";

export function AccountExports() {
  return (
    <Suspense fallback={<p role="status">Loading exports…</p>}>
      <AccountExportView />
    </Suspense>
  );
}

function AccountExportView() {
  const id = useSearchParams().get("export");
  return id === null ? <ExportTasks /> : <LinkedExport key={id} id={id} />;
}

function LinkedExport({ id }: { id: string }) {
  const cache = useWorkspaceCache();
  const valid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
  const query = useQuery({
    ...cache.resource<Task>(`/tasks/${valid ? id : "invalid"}`),
    enabled: valid,
    retry: false,
    staleTime: 0,
    refetchInterval: ({ state }) => {
      if (state.error || !state.data) return false;
      if (active(state.data)) return 2000;
      return state.data.downloadable && state.data.expiresAt
        ? Math.max(1000, Date.parse(state.data.expiresAt) - Date.now())
        : false;
    },
  });
  const task =
    query.data?.kind === "export" && query.data.id === id ? query.data : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function retry() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await cache.api(`/tasks/${id}/retry`, {});
      await query.refetch();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="export-tasks" aria-label="Requested export">
      <h2 className="font-editorial font-semibold">Your requested export</h2>
      {!valid || query.isError || (!query.isPending && !task) ? (
        <p className="mt-2 text-sm" role="status">
          This export is unavailable.
        </p>
      ) : !task ? (
        <p className="mt-2 text-sm" role="status">
          Loading export…
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm" role="status">
            {status(task)}
          </p>
          {task.downloadable ? (
            <a
              className="app-button secondary mt-3"
              href={`/api/grove/tasks/${id}/download`}
              download
            >
              Download export
            </a>
          ) : !active(task) ? (
            <Button
              variant="secondary"
              className="mt-3"
              disabled={busy}
              onClick={() => void retry()}
            >
              Prepare a fresh export
            </Button>
          ) : null}
        </>
      )}
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      <p className="mt-3 text-sm">
        <Link className="text-button" href="/app/settings/data">
          View all exports
        </Link>
      </p>
    </section>
  );
}

const active = (task: Task) =>
  task.status === "pending" || task.status === "running";
const status = (task: Task) => {
  if (task.downloadable) return "Ready";
  if (task.status === "pending") return "Queued";
  if (task.status === "running")
    return task.processed
      ? `Preparing export · ${task.processed.toLocaleString()} records`
      : "Preparing export…";
  if (task.status === "cancelled") return "Cancelled";
  if (task.error === "export_changed") return "Notes changed";
  if (task.error === "export_expired") return "Expired";
  if (task.status === "failed") return "Export failed";
  return "Download unavailable";
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
  function restoreFocus(trigger: HTMLButtonElement) {
    if (
      document.activeElement === trigger ||
      document.activeElement === document.body
    )
      heading.current?.focus({ preventScroll: true });
  }
  async function mutate(
    trigger: HTMLButtonElement,
    id?: string,
    action?: "cancel" | "retry",
  ) {
    if (inFlight.current || query.isError) return;
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
      restoreFocus(trigger);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }
  return (
    <section className="export-tasks" aria-label="Exports">
      <h2
        ref={heading}
        tabIndex={-1}
        className={
          projectId ? "text-sm font-medium" : "font-editorial font-semibold"
        }
      >
        {projectId ? "Notes and version history" : "Export your data"}
      </h2>
      <p className="mt-1 text-sm text-muted">
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
        Include original media (larger download)
      </label>
      <Button
        variant="secondary"
        className="mt-3"
        disabled={!!busy || !!running || query.isPending || query.isError}
        onClick={(event) => void mutate(event.currentTarget)}
      >
        {busy === "new" && (
          <LoaderCircle
            aria-hidden="true"
            size={16}
            className="motion-safe:animate-spin"
          />
        )}
        {busy === "new" ? "Requesting export…" : "Prepare export"}
      </Button>
      {(error || query.isError) && (
        <div className="mt-3 flex items-center gap-2">
          <p className="app-error" role="alert">
            {error || "Exports couldn’t load."}
          </p>
          {query.isError && (
            <IconButton
              label="Reload exports"
              disabled={query.isFetching || !!busy}
              onClick={async (event) => {
                const trigger = event.currentTarget;
                if ((await query.refetch()).isSuccess) restoreFocus(trigger);
              }}
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
        className="divide-y divide-line not-empty:mt-3"
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
              <p className="text-sm">
                {query.isError ? "Status unavailable" : status(task)}
              </p>
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
            {query.isError ? null : task.downloadable ? (
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
                onClick={(event) =>
                  void mutate(event.currentTarget, task.id, "cancel")
                }
              >
                <X size={16} />
              </IconButton>
            ) : (
              <IconButton
                label="Retry export"
                disabled={!!busy || exports.some(active)}
                onClick={(event) =>
                  void mutate(event.currentTarget, task.id, "retry")
                }
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
