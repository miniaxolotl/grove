"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  ArrowUpRight,
  Leaf,
  Archive,
  Clock,
  RefreshCw,
} from "lucide-react";
import type { Memory, Page } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";

export function MemoryLibrary({
  archive = false,
  initialId,
}: {
  archive?: boolean;
  initialId?: string;
}) {
  const [items, setItems] = useState<Memory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState(archive ? "archived" : "active");
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [selected, setSelected] = useState<Memory | "new" | null>(null);
  const filtered = Boolean(
    search ||
    project !== "all" ||
    kind ||
    status !== (archive ? "archived" : "active"),
  );
  const filters = {
    query: search || undefined,
    projectId:
      project === "all" ? undefined : project === "personal" ? null : project,
    kind: kind || undefined,
    status,
  };
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setItems([]);
      setNext(null);
      try {
        const [page, projectList] = await Promise.all([
          api<Page<Memory>>(
            "/memories/search",
            {
              query: search || undefined,
              projectId:
                project === "all"
                  ? undefined
                  : project === "personal"
                    ? null
                    : project,
              kind: kind || undefined,
              status,
            },
            undefined,
            controller.signal,
          ),
          api<Project[]>("/projects", undefined, undefined, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setItems(page.items);
          setNext(page.nextCursor);
          setProjects(projectList);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [search, project, kind, status, refresh, retryAttempt]);
  useEffect(() => {
    if (!initialId) return;
    const controller = new AbortController();
    api<Memory>(
      `/memories/${initialId}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then(setSelected)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [initialId, retryAttempt]);
  const reload = (message: string) => {
    setSelected(null);
    setNotice(message);
    setRefresh((value) => value + 1);
  };
  async function loadMore() {
    setLoading(true);
    try {
      const page = await api<Page<Memory>>("/memories/search", {
        ...filters,
        cursor: next,
      });
      setItems((current) => [...current, ...page.items]);
      setNext(page.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="app-page-heading">
        <div>
          <p className="eyebrow">
            {archive ? "KEPT FOR LATER" : "CONTEXT THAT STAYS"}
          </p>
          <h1>
            {archive ? "Your archive" : "Your memories"}
            <span className="text-leaf">.</span>
          </h1>
          <p>
            {archive
              ? "Out of recall. Still yours to revisit, restore, or let go."
              : "The useful things, remembered. Across projects, sessions, and agents."}
          </p>
        </div>
        {!archive && (
          <button className="app-button" onClick={() => setSelected("new")}>
            <Plus size={16} />
            Add memory
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      <form
        className="app-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
        }}
      >
        <label className="app-search">
          <Search size={18} />
          <span className="sr-only">Search memories</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your memories…"
            maxLength={1000}
          />
          <button type="submit" className="text-xs font-medium">
            Search
          </button>
        </label>
        <label>
          <span className="sr-only">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects</option>
            <option value="personal">Personal</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Memory kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {["preference", "fact", "decision", "solution", "handoff"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        {archive && (
          <label>
            <span className="sr-only">Archive status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="archived">Archived</option>
              <option value="expired">Expired handoffs</option>
            </select>
          </label>
        )}
        {filtered && (
          <button
            type="button"
            className="app-button secondary"
            onClick={() => {
              setQuery("");
              setSearch("");
              setProject("all");
              setKind("");
              setStatus(archive ? "archived" : "active");
            }}
          >
            Clear filters
          </button>
        )}
      </form>
      {error && (
        <LoadError
          message={error}
          retry={() => setRetryAttempt((value) => value + 1)}
        />
      )}
      <div className="mb-3 mt-7 flex items-center justify-between text-[10px] font-medium uppercase tracking-widest text-muted">
        <span>
          {archive ? "Saved outside active recall" : "Memory library"}
        </span>
        <span>{items.length} loaded</span>
      </div>
      {loading && !items.length ? (
        <p role="status" className="app-empty">
          Loading your memories…
        </p>
      ) : !items.length && !error ? (
        <section className="app-empty">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-sage">
            {archive ? (
              <Archive size={24} strokeWidth={1.3} />
            ) : (
              <Leaf size={24} strokeWidth={1.3} />
            )}
          </div>
          <h2 className="font-editorial text-3xl">
            {filtered
              ? "Nothing here matches yet."
              : archive
                ? "A little room for later."
                : "Good things start small."}
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-muted">
            {filtered
              ? "Try a different word, adjust a filter, or clear filters above to see everything again."
              : archive
                ? "Archived memories stay here until you restore or delete them."
                : "Save a preference, a decision, or something you learned. Your agents can pick up where you left off."}
          </p>
          {!archive && !filtered && (
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="app-button" onClick={() => setSelected("new")}>
                Save your first memory
              </button>
              <Link href="/app/connections" className="app-button secondary">
                Connect an agent <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
        </section>
      ) : (
        <ul className="app-memory-list">
          {items.map((memory) => (
            <li key={memory.id}>
              <button
                className="app-memory-row"
                onClick={() => setSelected(memory)}
              >
                <span className="memory-kind" data-kind={memory.kind}>
                  {memory.kind}
                </span>
                <span className="min-w-0">
                  <span className="block whitespace-pre-wrap text-sm leading-7 line-clamp-2">
                    {memory.content}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>
                      {projects.find((p) => p.id === memory.projectId)?.name ??
                        (memory.projectId ? "Project" : "Personal")}
                    </span>
                    <span>via {memory.source.agent}</span>
                    <span>
                      {new Date(memory.updatedAt).toLocaleDateString()}
                    </span>
                    {memory.kind === "handoff" && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        Temporary
                      </span>
                    )}
                    {memory.indexing !== "ready" && (
                      <span>Semantic index {memory.indexing}</span>
                    )}
                  </span>
                </span>
                <ArrowUpRight className="text-muted" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="mt-6 text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="app-button secondary"
          >
            <RefreshCw size={14} />
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
      {selected && (
        <Dialog
          title={selected === "new" ? "Plant a memory" : "Memory details"}
          close={() => setSelected(null)}
        >
          <MemoryEditor
            memory={selected === "new" ? undefined : selected}
            projects={projects}
            done={reload}
          />
        </Dialog>
      )}
    </>
  );
}

function MemoryEditor({
  memory,
  projects,
  done,
}: {
  memory?: Memory;
  projects: Project[];
  done: (message: string) => void;
}) {
  const [content, setContent] = useState(memory?.content ?? "");
  const [kind, setKind] = useState(memory?.kind ?? "fact");
  const [projectId, setProjectId] = useState(memory?.projectId ?? "");
  const [taskId, setTaskId] = useState(memory?.taskId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<
    { version: number; content: string; createdAt: string }[]
  >([]);
  const pending = useRef<{ fingerprint: string; operationId: string } | null>(
    null,
  );
  const operationId = (value: unknown) => {
    const fingerprint = JSON.stringify(value);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, operationId: crypto.randomUUID() };
    return pending.current.operationId;
  };
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  async function save() {
    const value = {
      content,
      kind,
      projectId: projectId || null,
      ...(kind === "handoff" ? { taskId } : {}),
      source: { agent: "website" },
      ...(memory ? { id: memory.id, expectedVersion: memory.version } : {}),
    };
    const saved = await api<Memory>("/memories", {
      ...value,
      operationId: operationId(value),
    });
    done(`Memory saved. Semantic indexing: ${saved.indexing}.`);
  }
  async function lifecycle(action: "archive" | "restore", revision?: number) {
    const value = { expectedVersion: memory!.version, revision };
    await api(`/memories/${memory!.id}/${action}`, {
      ...value,
      operationId: operationId({ action, ...value }),
    });
    done(
      action === "archive"
        ? "Memory moved to the archive."
        : "Memory restored to active recall.",
    );
  }
  const restore =
    memory?.status === "archived" ||
    (memory?.expiresAt && new Date(memory.expiresAt) < new Date());
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(save);
        }}
        className="app-form"
      >
        <label>
          What should stay with you?
          <textarea
            rows={7}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            maxLength={6000}
            autoFocus
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label>
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Memory["kind"])}
            >
              {["preference", "fact", "decision", "solution", "handoff"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Scope
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
        {kind === "handoff" && (
          <label>
            Stable task ID
            <input
              required
              maxLength={128}
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
            />
            <small className="text-muted">
              Active for 30 days; temporary content purged after 90.
            </small>
          </label>
        )}
        {error && (
          <p role="alert" className="app-error">
            {error}
          </p>
        )}
        <button disabled={busy} className="app-button">
          {busy ? "Saving…" : "Save memory"}
        </button>
      </form>
      {memory && (
        <div className="mt-8 border-t border-line pt-6">
          <dl className="grid grid-cols-2 gap-3 text-xs text-muted">
            <div>
              <dt>Source</dt>
              <dd className="mt-1 text-forest">
                {memory.source.agent} · revision {memory.version}
              </dd>
            </div>
            <div>
              <dt>Saved</dt>
              <dd className="mt-1 text-forest">
                {new Date(memory.createdAt).toLocaleString()}
              </dd>
            </div>
            {memory.expiresAt && (
              <div>
                <dt>Leaves recall</dt>
                <dd>{new Date(memory.expiresAt).toLocaleDateString()}</dd>
              </div>
            )}
            {memory.purgeAt && (
              <div>
                <dt>Permanent purge</dt>
                <dd>{new Date(memory.purgeAt).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>
          {memory.source.verification && (
            <p className="mt-4 text-sm">
              Verification: {memory.source.verification}
            </p>
          )}
          <p className="mt-4 break-all font-mono text-[10px] text-muted">
            {memory.id}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="app-button secondary"
              disabled={busy}
              onClick={() =>
                execute(() => lifecycle(restore ? "restore" : "archive"))
              }
            >
              {restore ? "Restore" : "Archive"}
            </button>
            <button
              className="app-button secondary"
              disabled={busy}
              onClick={() =>
                execute(async () =>
                  setHistory(await api(`/memories/${memory.id}/revisions`)),
                )
              }
            >
              Revision history
            </button>
            <button
              className="app-button danger"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete permanently
            </button>
          </div>
          {confirmDelete && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
              <p>
                This removes the memory and every revision. It cannot be undone.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  className="app-button danger"
                  disabled={busy}
                  onClick={() =>
                    execute(async () => {
                      const value = {
                        items: [
                          { id: memory.id, expectedVersion: memory.version },
                        ],
                      };
                      const result = await api<{
                        results: { outcome: string }[];
                      }>("/memories/delete", {
                        ...value,
                        operationId: operationId(value),
                      });
                      if (result.results[0].outcome !== "deleted")
                        throw new Error(
                          "Memory changed; reload before deleting.",
                        );
                      done("Memory permanently deleted.");
                    })
                  }
                >
                  Delete this memory
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="app-button secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {history.length > 0 && (
            <ol className="mt-6 space-y-4">
              {history.map((revision) => (
                <li
                  key={revision.version}
                  className="rounded-lg border border-line p-4"
                >
                  <p className="text-xs text-muted">
                    Revision {revision.version} ·{" "}
                    {new Date(revision.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                    {revision.content}
                  </p>
                  {revision.version !== memory.version && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        execute(() => lifecycle("restore", revision.version))
                      }
                      className="mt-3 text-xs underline"
                    >
                      Restore as a new revision
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  );
}
