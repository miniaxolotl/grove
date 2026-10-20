"use client";
import { useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Archive,
  Folder,
  FolderInput,
  SlidersHorizontal,
  X,
  Undo2,
  UserRound,
  BookOpen,
} from "lucide-react";
import type { Memory, Page } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { isInactive, memoryTitle, moveMemoryInput } from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { MemoryRow } from "./memory-row";
import { MemoryEditor } from "./memory-editor";
import { MemoryDetail } from "./memory-detail";

type Action = "move" | "archive" | "restore";
type Undo = { before: Memory; after: Memory; action: Action };
const dragType = "application/x-grove-memories";

export function MemoryLibrary({
  archive = false,
  initialId,
  projectId: fixedProject,
  embedded = false,
  onChanged,
}: {
  archive?: boolean;
  initialId?: string;
  projectId?: string | null;
  embedded?: boolean;
  onChanged?: () => void;
}) {
  const [loadedItems, setItems] = useState<Memory[]>([]);
  const [resultKey, setResultKey] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const [kind, setKind] = useState("");
  const [tag, setTag] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [searchMode, setSearchMode] = useState<string>();
  const [status, setStatus] = useState(archive ? "archived" : "active");
  const [cursor, setNext] = useState<string | null>(null);
  const [fetching, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Memory | "new" | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [moving, setMoving] = useState<Memory[] | null>(null);
  const [destination, setDestination] = useState("personal");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [dragged, setDragged] = useState<Memory[]>([]);
  const requests = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const scopedProject =
    fixedProject !== undefined
      ? fixedProject
      : project === "all"
        ? undefined
        : project === "personal"
          ? null
          : project;
  const requestKey = JSON.stringify({
    search,
    project: scopedProject,
    kind,
    tag,
    status,
    refresh,
  });
  const items = resultKey === requestKey ? loadedItems : [];
  const next = resultKey === requestKey ? cursor : null;
  const loading = fetching || resultKey !== requestKey;
  const currentError = resultKey === requestKey ? error : "";
  const filtered = !!(
    search ||
    kind ||
    tag ||
    (fixedProject === undefined && project !== "all") ||
    status !== (archive ? "archived" : "active")
  );
  const selectedItems = items.filter((memory) => checked.includes(memory.id));

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    Promise.all([
      api<Page<Memory>>(
        "/memories/search",
        {
          query: search || undefined,
          projectId: scopedProject,
          kind: kind || undefined,
          tag: tag || undefined,
          status,
        },
        undefined,
        request.signal,
      ),
      api<Project[]>("/projects", undefined, undefined, request.signal),
    ])
      .then(([page, list]) => {
        if (request.signal.aborted) return;
        setError("");
        setChecked([]);
        setItems(page.items);
        setNext(page.nextCursor);
        setSearchMode(page.searchMode);
        setProjects(list);
      })
      .catch((e) => {
        if (!request.signal.aborted) {
          setError(errorMessage(e));
          setItems([]);
          setNext(null);
        }
      })
      .finally(() => {
        if (!request.signal.aborted) {
          setLoading(false);
          setResultKey(requestKey);
        }
      });
    return () => request.abort();
  }, [search, scopedProject, kind, tag, status, refresh, requestKey]);
  useEffect(() => {
    if (!initialId) return;
    const request = new AbortController();
    api<Memory>(`/memories/${initialId}`, undefined, undefined, request.signal)
      .then((memory) => {
        if (!request.signal.aborted) setSelected(memory);
      })
      .catch((e) => {
        if (!request.signal.aborted) setDetailError(errorMessage(e));
      });
    return () => request.abort();
  }, [initialId]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      event.preventDefault();
      searchInput.current?.focus();
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  function reload(message?: string) {
    setSelected(null);
    if (message) setNotice(message);
    setRefresh((value) => value + 1);
    onChanged?.();
  }
  async function loadMore() {
    const request = controller.current;
    if (!request || loading || !next) return;
    setLoading(true);
    setError("");
    try {
      const page = await api<Page<Memory>>(
        "/memories/search",
        {
          query: search || undefined,
          projectId: scopedProject,
          kind: kind || undefined,
          tag: tag || undefined,
          status,
          cursor: next,
        },
        undefined,
        request.signal,
      );
      if (!request.signal.aborted) {
        setItems((current) => [
          ...current,
          ...page.items.filter((m) => !current.some((old) => old.id === m.id)),
        ]);
        setNext(page.nextCursor);
      }
    } catch (e) {
      if (!request.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  async function mutate(
    memory: Memory,
    action: Action,
    target?: string | null,
  ) {
    const path =
      action === "move" ? "/memories" : `/memories/${memory.id}/${action}`;
    const body =
      action === "move"
        ? moveMemoryInput(memory, target ?? null)
        : { expectedVersion: memory.version };
    const fingerprint = JSON.stringify({ path, body });
    if (!requests.current.has(fingerprint))
      requests.current.set(fingerprint, crypto.randomUUID());
    return api<Memory>(path, {
      ...body,
      operationId: requests.current.get(fingerprint),
    });
  }
  async function perform(
    memories: Memory[],
    action: Action,
    target?: string | null,
  ) {
    if (busy) return;
    const work = memories
      .filter((memory) => action !== "move" || memory.projectId !== target)
      .slice(0, 50);
    if (!work.length) {
      setMoving(null);
      setNotice("Already in this project.");
      return;
    }
    setBusy(true);
    setError("");
    setFailures([]);
    setNotice("");
    setUndo([]);
    const completed: Undo[] = [];
    const failures: string[] = [];
    for (const memory of work) {
      try {
        completed.push({
          before: memory,
          // An idempotent retry may return a newer version written by an agent.
          // Undo must still check the version produced by our own operation.
          after: {
            ...(await mutate(memory, action, target)),
            version: memory.version + 1,
          },
          action,
        });
      } catch (e) {
        failures.push(`${memoryTitle(memory)}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    setMoving(null);
    setSelected(null);
    setChecked([]);
    setUndo(completed);
    setFailures(failures);
    const verb =
      action === "move"
        ? "moved"
        : action === "archive"
          ? "archived"
          : "restored";
    setNotice(
      completed.length
        ? `${completed.length} ${completed.length === 1 ? "memory" : "memories"} ${verb}.`
        : "",
    );
    reload();
    // Retain mutation failures separately from the following successful list read.
    if (failures.length)
      setNotice(
        `${completed.length} ${verb}; ${failures.length} could not be ${verb}. See the details in the library.`,
      );
  }
  async function undoLast() {
    if (busy) return;
    setBusy(true);
    const remaining: Undo[] = [];
    let message = "";
    for (const record of undo) {
      try {
        await mutate(
          record.after,
          record.action === "move"
            ? "move"
            : record.action === "archive"
              ? "restore"
              : "archive",
          record.before.projectId,
        );
      } catch (e) {
        remaining.push(record);
        message = errorMessage(e);
      }
    }
    const count = undo.length - remaining.length;
    setUndo(remaining);
    setBusy(false);
    reload(
      remaining.length
        ? `${count} undone. ${remaining.length} could not be undone: ${message}`
        : "Change undone.",
    );
  }
  function startMove(memories: Memory[]) {
    if (busy || !memories.length) return;
    setSelected(null);
    setMoving(memories);
    setDestination("personal");
  }
  function startDrag(event: DragEvent, memory: Memory) {
    if (busy) {
      event.preventDefault();
      return;
    }
    const records = checked.includes(memory.id) ? selectedItems : [memory];
    setDragged(records);
    event.dataTransfer.setData(
      dragType,
      JSON.stringify(records.map((m) => m.id)),
    );
    event.dataTransfer.effectAllowed = "move";
  }
  function dragOver(event: DragEvent, target: string) {
    if (busy || !dragged.length || !event.dataTransfer.types.includes(dragType))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOver(target);
  }
  function drop(event: DragEvent, target: string) {
    event.preventDefault();
    setOver(null);
    if (
      busy ||
      !dragged.length ||
      event.dataTransfer.getData(dragType) !==
        JSON.stringify(dragged.map((m) => m.id))
    )
      return;
    const memories = dragged;
    setDragged([]);
    void perform(memories, "move", target === "personal" ? null : target);
  }
  const title = archive ? "Archive" : "Memories";
  const currentIndex =
    selected && selected !== "new"
      ? items.findIndex((m) => m.id === selected.id)
      : -1;
  return (
    <>
      <div className={`app-page-heading${embedded ? " compact-heading" : ""}`}>
        <div>
          {embedded ? (
            <h2 className="font-editorial text-3xl">{title}</h2>
          ) : (
            <h1>{title}</h1>
          )}
          <p>
            {archive
              ? "Saved outside active recall. Restore something whenever you need it."
              : "Find what matters. Keep it in the right place."}
          </p>
        </div>
        {!archive && (
          <button
            className="app-button"
            disabled={busy}
            onClick={() => setSelected("new")}
          >
            <Plus size={16} />
            Add memory
          </button>
        )}
      </div>
      <div
        className={`memory-workspace${embedded ? " embedded" : ""}`}
        onDragEnd={() => {
          setDragged([]);
          setOver(null);
        }}
      >
        {!embedded && (
          <aside className="library-places" aria-label="Memory locations">
            <button
              aria-pressed={project === "all"}
              onClick={() => setProject("all")}
            >
              <BookOpen size={16} />
              All memories
            </button>
            <button
              aria-pressed={project === "personal"}
              onClick={() => setProject("personal")}
              data-drop-active={over === "personal" || undefined}
              onDragOver={(event) => dragOver(event, "personal")}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => drop(event, "personal")}
            >
              <UserRound size={16} />
              Personal
            </button>
            <div className="places-heading">
              <span>Projects</span>
              <Link href="/app/projects">Manage</Link>
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                aria-pressed={project === p.id}
                onClick={() => setProject(p.id)}
                data-drop-active={over === p.id || undefined}
                onDragOver={(event) => dragOver(event, p.id)}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => drop(event, p.id)}
              >
                <Folder size={16} />
                <span>{p.name}</span>
              </button>
            ))}
            <p className="places-hint">
              Drag a memory onto a project to move it. You can also select
              memories and choose Move.
            </p>
          </aside>
        )}
        <div className="library-main">
          <form
            className="workspace-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
            }}
          >
            <div className="app-search">
              <Search size={18} />
              <input
                ref={searchInput}
                aria-label="Search memories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by words or meaning…"
                maxLength={1000}
              />
              <button type="submit">Search</button>
            </div>
            <button
              type="button"
              className="app-button secondary"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal size={16} />
              Filters{kind || tag ? " · active" : ""}
            </button>
          </form>
          {showFilters && (
            <form
              className="library-filters app-form"
              onSubmit={(event) => {
                event.preventDefault();
                setTag(tagDraft.trim());
              }}
            >
              {fixedProject === undefined && (
                <label>
                  Project
                  <select
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  >
                    <option value="all">All projects</option>
                    <option value="personal">Personal</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Memory kind
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">All kinds</option>
                  {[
                    "preference",
                    "fact",
                    "decision",
                    "solution",
                    "handoff",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {k === "handoff"
                        ? "Task handoffs"
                        : k[0].toUpperCase() + k.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Topic tag
                <input
                  value={tagDraft}
                  maxLength={40}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="e.g. architecture"
                  list="memory-topics"
                />
                <datalist id="memory-topics">
                  {[
                    ...new Set(
                      loadedItems.flatMap((m) => m.enrichment?.tags ?? []),
                    ),
                  ].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <button
                className="app-button secondary apply-tag"
                type="submit"
                disabled={tagDraft.trim() === tag}
              >
                Apply tag
              </button>
              {archive && (
                <label>
                  Archive status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="archived">Archived</option>
                    <option value="expired">Expired handoffs</option>
                  </select>
                </label>
              )}
            </form>
          )}
          {filtered && (
            <div className="filter-chips" aria-label="Active filters">
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    setQuery("");
                  }}
                  aria-label="Remove search filter"
                >
                  “{search}”<X size={13} />
                </button>
              )}
              {fixedProject === undefined && project !== "all" && (
                <button
                  onClick={() => setProject("all")}
                  aria-label="Remove project filter"
                >
                  {projects.find((p) => p.id === project)?.name ?? "Personal"}
                  <X size={13} />
                </button>
              )}
              {kind && (
                <button
                  onClick={() => setKind("")}
                  aria-label="Remove kind filter"
                >
                  {kind}
                  <X size={13} />
                </button>
              )}
              {tag && (
                <button
                  onClick={() => {
                    setTag("");
                    setTagDraft("");
                  }}
                  aria-label="Remove tag filter"
                >
                  {tag}
                  <X size={13} />
                </button>
              )}
              {status === "expired" && (
                <button
                  onClick={() => setStatus("archived")}
                  aria-label="Remove expired filter"
                >
                  Expired handoffs
                  <X size={13} />
                </button>
              )}
              <button
                className="clear-filters"
                onClick={() => {
                  setQuery("");
                  setSearch("");
                  setProject("all");
                  setKind("");
                  setTag("");
                  setTagDraft("");
                  setStatus(archive ? "archived" : "active");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
          <div className="library-caption">
            <span>
              {items.length}
              {next ? "+" : ""}{" "}
              {items.length === 1 && !next ? "memory" : "memories"}
              {searchMode && search
                ? ` · ${searchMode === "hybrid" ? "Words + meaning" : "Matching words"}`
                : ""}
            </span>
            <span className="library-shortcut">
              Press / to search · swipe a row for actions
            </span>
          </div>
          {selectedItems.length > 0 && (
            <div
              className="selection-toolbar"
              role="group"
              aria-label="Selected memories"
            >
              <strong>{selectedItems.length} selected</strong>
              <button disabled={busy} onClick={() => startMove(selectedItems)}>
                <FolderInput size={16} />
                Move
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(selectedItems, archive ? "restore" : "archive")
                }
              >
                <Archive size={16} />
                {archive ? "Restore" : "Archive"}
              </button>
              <button
                disabled={busy}
                onClick={() => setChecked([])}
                aria-label="Clear selection"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {currentError && (
            <LoadError
              message={currentError}
              retry={() => setRefresh((v) => v + 1)}
            />
          )}
          {detailError && (
            <div className="app-error" role="alert">
              {detailError}
              <button
                className="text-button ml-3"
                onClick={() => setDetailError("")}
              >
                Dismiss
              </button>
            </div>
          )}
          {!!failures.length && (
            <div className="app-error" role="alert">
              <p>
                Some memories could not be updated. The list below shows their
                current state.
              </p>
              <ul>
                {failures.map((failure, i) => (
                  <li key={i}>{failure}</li>
                ))}
              </ul>
              <button className="text-button" onClick={() => setFailures([])}>
                Dismiss details
              </button>
            </div>
          )}
          {loading && !items.length ? (
            <p role="status" className="library-loading">
              Loading your memories…
            </p>
          ) : !items.length && !currentError ? (
            <section className="app-empty">
              <BookOpen size={26} className="mx-auto mb-4" strokeWidth={1.4} />
              <h2 className="font-editorial text-3xl">
                {filtered
                  ? "Nothing here matches yet."
                  : archive
                    ? "Your archive is empty."
                    : "Good things start small."}
              </h2>
              <p>
                {filtered
                  ? "Try a different phrase or clear a filter."
                  : archive
                    ? "Archived memories stay here until you restore or delete them."
                    : "Save a useful note, or connect an agent to bring context into your conversations."}
              </p>
              {!archive && !filtered && (
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button
                    className="app-button"
                    onClick={() => setSelected("new")}
                  >
                    Save your first memory
                  </button>
                  <Link
                    href="/app/connections"
                    className="app-button secondary"
                  >
                    Connect an agent
                  </Link>
                </div>
              )}
            </section>
          ) : (
            items.length > 0 && (
              <div className="library-list">
                <label className="select-loaded">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={
                      items.length > 0 &&
                      items.slice(0, 50).every((m) => checked.includes(m.id))
                    }
                    onChange={(e) =>
                      setChecked(
                        e.target.checked
                          ? items.slice(0, 50).map((m) => m.id)
                          : [],
                      )
                    }
                  />
                  Select loaded memories{items.length > 50 ? " (first 50)" : ""}
                </label>
                <ul>
                  {items.map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      projectName={
                        projects.find((p) => p.id === memory.projectId)?.name ??
                        "Personal"
                      }
                      selected={checked.includes(memory.id)}
                      busy={busy}
                      onSelect={() =>
                        setChecked((current) =>
                          current.includes(memory.id)
                            ? current.filter((id) => id !== memory.id)
                            : current.length < 50
                              ? [...current, memory.id]
                              : current,
                        )
                      }
                      onOpen={() => setSelected(memory)}
                      onMove={() => startMove([memory])}
                      onArchive={() =>
                        void perform(
                          [memory],
                          isInactive(memory) ? "restore" : "archive",
                        )
                      }
                      onTag={(value) => {
                        setTag(value);
                        setTagDraft(value);
                        setShowFilters(true);
                      }}
                      onDrag={startDrag}
                    />
                  ))}
                </ul>
              </div>
            )
          )}
          {next && (
            <div className="mt-6 text-center">
              <button
                className="app-button secondary"
                disabled={loading}
                onClick={loadMore}
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
      {(notice || busy) && (
        <div className="workspace-notice" role="status">
          <span>{busy ? "Updating memories…" : notice}</span>
          {undo.length > 0 && (
            <button disabled={busy} onClick={undoLast}>
              <Undo2 size={16} />
              Undo
            </button>
          )}
          <button
            disabled={busy}
            aria-label="Dismiss notification"
            onClick={() => {
              setNotice("");
              setUndo([]);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {selected && (
        <Dialog
          key={selected === "new" ? "new" : selected.id}
          panel
          title={selected === "new" ? "New memory" : "Memory details"}
          busy={busy}
          close={() => setSelected(null)}
        >
          {selected === "new" ? (
            <MemoryEditor
              projects={projects}
              projectId={scopedProject ?? null}
              cancel={() => setSelected(null)}
              done={() =>
                reload(
                  "Memory saved. Search and context will update in the background.",
                )
              }
            />
          ) : (
            <MemoryDetail
              key={`${selected.id}:${selected.version}`}
              memory={selected}
              projects={projects}
              busy={busy}
              onSaved={reload}
              onMove={() => startMove([selected])}
              onArchive={() =>
                void perform(
                  [selected],
                  isInactive(selected) ? "restore" : "archive",
                )
              }
              onPrevious={
                currentIndex > 0
                  ? () => setSelected(items[currentIndex - 1])
                  : undefined
              }
              onNext={
                currentIndex >= 0 && currentIndex < items.length - 1
                  ? () => setSelected(items[currentIndex + 1])
                  : undefined
              }
            />
          )}
        </Dialog>
      )}
      {moving && (
        <Dialog
          title={`Move ${moving.length === 1 ? "memory" : `${moving.length} memories`}`}
          close={() => setMoving(null)}
          busy={busy}
        >
          <form
            className="app-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                moving,
                "move",
                destination === "personal" ? null : destination,
              );
            }}
          >
            <p className="text-sm leading-7 text-muted">
              Choose where this context belongs. The memory and its history stay
              together.
            </p>
            <label>
              Destination
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="personal">Personal</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted">
              Agents with access to the destination can recall these memories.
            </p>
            <button disabled={busy} className="app-button">
              {busy ? "Moving…" : "Move here"}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
