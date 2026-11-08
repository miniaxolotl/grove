"use client";
import { ImportNotesButton } from "./import-notes-button";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  X,
  Undo2,
  BookOpen,
  List,
  Network,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import type { Memory, MemoryList } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import {
  dateLabel,
  isInactive,
  memoryTitle,
  moveMemoryInput,
} from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { LoadingState } from "./loading-state";
import { MemoryRow } from "./memory-row";
import { deferredFeature } from "./deferred-feature";
import { LibrarySelection } from "./library-selection";
import { useWorkspaceDrag } from "./memory-drag";
import { WorkspaceNotice } from "./toasts";
import {
  LibraryFilterBar,
  initialFilters,
  type LibraryFilters,
} from "./library-filters";
import { PageHeading } from "./ui/page-heading";
import { SegmentedControl } from "./ui/segmented-control";
import { NotebookSelect } from "./notebook-select";
import { useNotebooks, useSetCurrentNotebook } from "./notebooks-provider";
import { NoteDeleteDialog } from "./note-delete-dialog";
import { AssistanceAction } from "./assistance-action";
import { useNotebookVisit } from "./use-notebook-visit";
import type { NotebookVisit } from "@lib/shared/assistance";
const loadDetail = () =>
  import("./memory-detail").then((module) => ({
    default: module.MemoryDetail,
  }));
const MemoryDetail = deferredFeature(loadDetail, "Opening your note…", {
  className: "note-editor-drawer",
  failureTitle: "Your note couldn’t open",
  failureDescription: "Try again, or close this view to return to your notes.",
});
const MemoryEditor = deferredFeature(
  async () => ({ default: (await import("./memory-editor")).MemoryEditor }),
  "Opening your writing space…",
  { failureTitle: "Your writing space couldn’t open" },
);
const MemoryGraph = dynamic(() => import("./memory-graph"), {
  ssr: false,
  loading: () => (
    <p role="status" className="library-loading">
      Opening graph…
    </p>
  ),
});

type Action = "move" | "archive" | "restore";
type Undo = { before: Memory; after: Memory; action: Action };

export function MemoryLibrary({
  archive = false,
  initialId,
  projectId: fixedProject,
  embedded = false,
  initialKind = "",
  onChanged,
  initialView = "list",
  initialProject = "all",
  initialSort = "updated_desc",
  onVisit,
}: {
  archive?: boolean;
  initialId?: string;
  projectId?: string | null;
  embedded?: boolean;
  initialKind?: string;
  onChanged?: () => void;
  initialView?: "list" | "graph";
  initialProject?: string;
  initialSort?: "updated_desc" | "created_desc";
  onVisit?: (visit: NotebookVisit) => void;
}) {
  const cache = useWorkspaceCache();
  const api = cache.api;
  const workspace = useWorkspaceDrag();
  const [view, setView] = useState(initialView);
  const {
    projects,
    error: notebookError,
    reload: reloadNotebooks,
  } = useNotebooks();
  const [filters, setFilters] = useState<LibraryFilters>(() => ({
    ...initialFilters(archive),
    kind: initialKind,
    project: initialProject,
    sort: initialSort,
  }));
  const {
    search,
    project,
    kind,
    tag,
    status,
    sourceAgent,
    updatedAfter,
    sort,
    lifetime,
  } = filters;
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [selectedId, selectId] = useState<string | null>(initialId ?? null);
  const detail = useQuery({
    ...cache.note(selectedId ?? ""),
    enabled: !!selectedId && selectedId !== "new",
  });
  const selected = selectedId === "new" ? "new" : detail.data;
  const setSelected = (note: Memory | "new" | null) =>
    selectId(typeof note === "string" ? note : (note?.id ?? null));
  const detailError = detail.error ? errorMessage(detail.error) : "";
  const [deleting, setDeleting] = useState<Memory[] | null>(null);
  const focusAfterDelete = useRef<string | null | undefined>(undefined);
  const [checked, setChecked] = useState<string[]>([]);
  const [moving, setMoving] = useState<Memory[] | null>(null);
  const [destination, setDestination] = useState("personal");
  // In-flight mutation tracking replaces the old global busy lock: only rows
  // with a pending request disable their own controls. Everything else stays
  // usable while requests settle in the background.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const markPending = (ids: string[]) =>
    setPending((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  const unmarkPending = (ids: string[]) =>
    setPending((current) => {
      if (!ids.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  const busy = pending.size > 0;
  const [undo, setUndo] = useState<Undo[]>([]);
  const requests = useRef(new Map<string, string>());
  const summary = useRef<HTMLSpanElement>(null);
  const scopedProject =
    fixedProject !== undefined
      ? fixedProject
      : project === "all"
        ? undefined
        : project === "personal"
          ? null
          : project;
  const noteOptions = cache.notes({
    query: search,
    projectId: scopedProject,
    kind: (kind || undefined) as MemoryList["kind"],
    tag: tag || undefined,
    status: status as MemoryList["status"],
    sourceAgent: (sourceAgent || undefined) as MemoryList["sourceAgent"],
    updatedAfter: updatedAfter || undefined,
    sort,
    lifetime: (lifetime || undefined) as MemoryList["lifetime"],
  });
  const query = useInfiniteQuery({
    ...noteOptions,
    refetchInterval: (q) =>
      q.state.data?.pages[0]?.visit?.ready === false ? 500 : false,
  });
  useNotebookVisit(
    query.isSuccess && !query.isFetching
      ? query.data.pages[0]?.visit
      : undefined,
    onVisit,
  );
  useSetCurrentNotebook(scopedProject);
  const items = useMemo(
    () => [
      ...new Map(
        query.data?.pages
          .flatMap((page) => page.items)
          .map((note) => [note.id, note]),
      ).values(),
    ],
    [query.data],
  );
  const next = query.hasNextPage;
  const loading = query.isPending || query.isFetchingNextPage;
  const searchMode = query.data?.pages[0]?.searchMode;
  const matches = Object.assign(
    {},
    ...(query.data?.pages.map((page) => page.matches ?? {}) ?? []),
  );
  const readError = query.error ? errorMessage(query.error) : "";
  const staleSearch =
    query.error instanceof Error &&
    "code" in query.error &&
    ["stale_search", "invalid_cursor"].includes(String(query.error.code));
  const currentError = error || (!query.data ? readError : "");
  const refreshing =
    !!query.data && query.isFetching && !query.isFetchingNextPage;
  const filtered = !!(
    search ||
    kind ||
    tag ||
    sourceAgent ||
    updatedAfter ||
    lifetime ||
    (fixedProject === undefined && project !== "all") ||
    status !== (archive ? "archived" : "active")
  );
  const selectedItems = items.filter((memory) => checked.includes(memory.id));
  const pendingSelected = selectedItems.some((memory) =>
    pending.has(memory.id),
  );

  function reload(message?: string) {
    setSelected(null);
    if (message) setNotice(message);
    onChanged?.();
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
  /** The record the UI shows while a mutation settles: same note, next version. */
  function expectedNote(
    memory: Memory,
    action: Action,
    target?: string | null,
  ): Memory {
    return {
      ...memory,
      projectId: action === "move" ? (target ?? null) : memory.projectId,
      status:
        action === "archive"
          ? "archived"
          : action === "restore"
            ? "active"
            : memory.status,
      version: memory.version + 1,
    };
  }
  async function perform(
    memories: Memory[],
    action: Action,
    target?: string | null,
  ) {
    const skipped = memories.filter((memory) => pending.has(memory.id));
    const work = memories
      .filter(
        (memory) =>
          (action !== "move" || memory.projectId !== target) &&
          !pending.has(memory.id),
      )
      .slice(0, 50);
    if (!work.length) {
      setMoving(null);
      setNotice(
        skipped.length
          ? "Those notes are still updating. Try again when the update finishes."
          : "Already in this notebook.",
      );
      return;
    }
    const ids = work.map((memory) => memory.id);
    // Instant patch first: rows move immediately, requests settle behind it.
    markPending(ids);
    cache.applyNoteRecords(
      new Map(work.map((memory) => [memory.id, expectedNote(memory, action, target)])),
    );
    setMoving(null);
    setChecked((current) => current.filter((id) => !ids.includes(id)));
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
        // That note alone snaps back; every other row keeps its new state.
        cache.restoreNoteRecords(new Map([[memory.id, memory]]));
        failures.push(`${memoryTitle(memory)}: ${errorMessage(e)}`);
      }
    }
    unmarkPending(ids);
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
        ? `${completed.length} ${completed.length === 1 ? "note" : "notes"} ${verb}.${skipped.length ? ` ${skipped.length} still updating.` : ""}`
        : "",
    );
    reload();
    // Retain mutation failures separately from the following successful list read.
    if (failures.length)
      setNotice(
        `${completed.length} ${verb}; ${failures.length} could not be ${verb}. See the details in the library.${skipped.length ? ` ${skipped.length} still updating.` : ""}`,
      );
  }
  async function undoLast() {
    if (busy) return;
    const ids = undo.map((record) => record.before.id);
    markPending(ids);
    // Instant patch first, same as the mutation being undone.
    cache.applyNoteRecords(
      new Map(undo.map((record) => [record.before.id, record.before])),
    );
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
        cache.restoreNoteRecords(
          new Map([[record.after.id, record.after]]),
        );
        remaining.push(record);
        message = errorMessage(e);
      }
    }
    unmarkPending(ids);
    const count = undo.length - remaining.length;
    setUndo(remaining);
    reload(
      remaining.length
        ? `${count} undone. ${remaining.length} could not be undone: ${message}`
        : "Change undone.",
    );
  }
  function startMove(memories: Memory[]) {
    if (!memories.length) return;
    setSelected(null);
    setMoving(memories);
    const first = memories[0].projectId;
    setDestination(
      memories.every((note) => note.projectId === first)
        ? (first ?? "personal")
        : "",
    );
  }
  function deletedMany(memories: Memory[]) {
    const gone = new Set(memories.map((memory) => memory.id));
    const remaining = items.filter((item) => !gone.has(item.id));
    const firstIndex = items.findIndex((item) => gone.has(item.id));
    const neighbor =
      remaining[Math.min(Math.max(firstIndex, 0), remaining.length - 1)];
    focusAfterDelete.current = neighbor?.id ?? null;
    setDeleting(null);
    setChecked((checked) => checked.filter((id) => !gone.has(id)));
    reload();
  }
  function deleted(memory: Memory) {
    deletedMany([memory]);
  }
  useEffect(() => {
    if (focusAfterDelete.current === undefined || loading) return;
    const id = focusAfterDelete.current;
    const target =
      (id
        ? document.querySelector<HTMLElement>(
            `[data-note-id="${id}"] .memory-open`,
          )
        : null) ??
      document.querySelector<HTMLElement>(
        ".library-main .memory-open, .library-main .app-empty h2",
      );
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.tabIndex = target.tabIndex < 0 ? -1 : target.tabIndex;
      target.focus({ preventScroll: true });
      focusAfterDelete.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [items, loading]);
  const title = archive
    ? "Archive"
    : initialView === "graph"
      ? "Note graph"
      : "Notes";
  const detailBusy =
    selected && selected !== "new" ? pending.has(selected.id) : false;
  const moveBusy = moving?.some((note) => pending.has(note.id)) ?? false;
  const currentIndex =
    selected && selected !== "new"
      ? items.findIndex((m) => m.id === selected.id)
      : -1;
  return (
    <>
      {!embedded && (
        <PageHeading
          title={title}
          actions={
            !archive && (
              <>
                <ImportNotesButton projectId={scopedProject ?? undefined} />
                <Link
                  className="app-button secondary"
                  href={`/app/notes/new?from=journal${scopedProject ? `&notebook=${encodeURIComponent(scopedProject)}` : ""}`}
                >
                  <CalendarDays size={16} />
                  Today’s note
                </Link>
              </>
            )
          }
        />
      )}
      <div className={`memory-workspace${embedded ? " embedded" : ""}`}>
        <div className="library-main">
          {notebookError && (
            <button className="text-button" onClick={reloadNotebooks}>
              Retry notebooks
            </button>
          )}
          <LibraryFilterBar
            value={filters}
            onChange={setFilters}
            projects={projects}
            fixedProject={fixedProject}
            archive={archive}
            topics={[
              ...new Set(
                items.flatMap((memory) => memory.enrichment?.tags ?? []),
              ),
            ]}
          />
          <div className="library-caption">
            <span className="library-summary" ref={summary} tabIndex={-1}>
              <span className="library-summary-label">
                {query.data ? (
                  <>
                    {items.length}
                    {next ? "+" : ""}{" "}
                    {items.length === 1 && !next ? "note" : "notes"}
                    {searchMode && search ? " found" : ""}
                  </>
                ) : (
                  "Your notes"
                )}
                {fixedProject === undefined && project !== "all" && (
                  <span className="library-scope">
                    {projects.find((item) => item.id === project)?.name ??
                      "Unfiled"}
                  </span>
                )}
              </span>
              <span className="library-sync" role="status">
                {query.data && readError ? (
                  <>
                    <span className="sr-only">
                      {staleSearch
                        ? "Search changed. Refresh results."
                        : query.isFetchNextPageError
                          ? "Couldn’t load more. Showing loaded notes."
                          : "Couldn’t refresh. Showing saved notes."}
                    </span>
                    <button
                      type="button"
                      className="library-refresh-retry"
                      aria-label={
                        staleSearch
                          ? "Refresh search results"
                          : query.isFetchNextPageError
                            ? "Retry loading more notes"
                            : "Retry refreshing notes"
                      }
                      aria-busy={query.isFetching}
                      disabled={query.isFetching}
                      title={`Showing loaded notes. ${readError}`}
                      onClick={() => {
                        summary.current?.focus({ preventScroll: true });
                        if (query.isFetchNextPageError && !staleSearch)
                          void query.fetchNextPage();
                        else void query.refetch();
                      }}
                    >
                      <RefreshCw size={14} aria-hidden="true" /> Retry
                    </button>
                  </>
                ) : refreshing ? (
                  <span className="library-refreshing">
                    <RefreshCw size={14} aria-hidden="true" />
                    <span className="sr-only">Refreshing notes…</span>
                  </span>
                ) : null}
              </span>
            </span>
            {!archive && (
              <SegmentedControl
                label="Note view"
                value={view}
                onChange={setView}
                options={[
                  {
                    value: "list",
                    label: (
                      <>
                        <List size={15} />
                        List
                      </>
                    ),
                  },
                  {
                    value: "graph",
                    label: (
                      <>
                        <Network size={15} />
                        Graph
                      </>
                    ),
                  },
                ]}
              />
            )}
          </div>
          {currentError && (
            <LoadError
              title={
                archive
                  ? "Your archive couldn’t load"
                  : "Your notes couldn’t load"
              }
              message={currentError}
              retry={() => {
                setError("");
                void query.refetch();
              }}
            />
          )}
          {detailError && (
            <div className="app-error" role="alert">
              {detailError}
              <button
                className="text-button ml-3"
                onClick={() => setSelected(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          {!!failures.length && (
            <div className="app-error" role="alert">
              <p>
                Some notes could not be updated. The list below shows their
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
            <LoadingState
              label="Opening your notes…"
              className="library-placeholder"
              list
            />
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
                    ? "Archived notes stay here until you restore or delete them."
                    : "Start with a thought, a plan, or something you want to remember."}
              </p>
              {filtered && (
                <button
                  type="button"
                  className="app-button secondary mt-6"
                  onClick={() =>
                    setFilters((current) => ({
                      ...initialFilters(archive),
                      sort: current.sort,
                    }))
                  }
                >
                  Clear filters
                </button>
              )}
              {!archive && !filtered && (
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link
                    className="app-button"
                    href={`/app/notes/new${scopedProject ? `?notebook=${encodeURIComponent(scopedProject)}` : ""}`}
                  >
                    Write your first note
                  </Link>
                  <Link
                    href="/app/settings/connections"
                    className="app-button secondary"
                  >
                    Connect an agent
                  </Link>
                </div>
              )}
            </section>
          ) : (
            items.length > 0 &&
            (view === "graph" ? (
              <MemoryGraph
                key={JSON.stringify(noteOptions.queryKey)}
                items={items}
                projects={projects}
                onOpen={setSelected}
              />
            ) : (
              <div
                className="library-list"
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    !event.defaultPrevented &&
                    !workspace.active &&
                    selectedItems.length > 0 &&
                    !document.querySelector(
                      "[popover]:popover-open, [role=listbox]",
                    )
                  ) {
                    event.preventDefault();
                    setChecked([]);
                  }
                }}
              >
                <LibrarySelection
                  assistance={
                    !archive && (
                      <AssistanceAction
                        compact
                        disabled={pendingSelected || selectedItems.length > 6}
                        input={{
                          kind: "actions",
                          sources: selectedItems.map(({ id, version }) => ({
                            id,
                            version,
                          })),
                          projectId: scopedProject ?? null,
                        }}
                      />
                    )
                  }
                  count={selectedItems.length}
                  allSelected={items
                    .slice(0, 50)
                    .every((memory) => checked.includes(memory.id))}
                  limited={items.length > 50}
                  busy={pendingSelected}
                  archive={archive}
                  onSelectAll={(selected) =>
                    setChecked(
                      selected
                        ? items.slice(0, 50).map((memory) => memory.id)
                        : [],
                    )
                  }
                  onClear={() => setChecked([])}
                  onMove={() => startMove(selectedItems)}
                  onArchive={() =>
                    void perform(selectedItems, archive ? "restore" : "archive")
                  }
                  onDelete={() => setDeleting(selectedItems)}
                />
                <ul>
                  {items.map((memory, index) => (
                    <Fragment key={memory.id}>
                      {sort === "created_desc" &&
                        (index === 0 ||
                          dateLabel(memory.createdAt) !==
                            dateLabel(items[index - 1].createdAt)) && (
                          <li className="library-date">
                            <h2>{dateLabel(memory.createdAt)}</h2>
                          </li>
                        )}
                      <MemoryRow
                        query={search}
                        evidence={matches[memory.id]}
                        onIntent={() => {
                          void loadDetail().catch(() => {});
                        }}
                        memory={memory}
                        projectName={
                          projects.find((p) => p.id === memory.projectId)
                            ?.name ?? "Unfiled"
                        }
                        selected={checked.includes(memory.id)}
                        selectedItems={selectedItems}
                        busy={pending.has(memory.id)}
                        onSelect={() =>
                          setChecked((current) =>
                            current.includes(memory.id)
                              ? current.filter((id) => id !== memory.id)
                              : current.length < 50
                                ? [...current, memory.id]
                                : current,
                          )
                        }
                        onOpen={() => {
                          setDeleting(null);
                          setSelected(memory);
                        }}
                        onDelete={() => {
                          setDeleting([memory]);
                        }}
                        onMove={() => startMove([memory])}
                        onArchive={() =>
                          void perform(
                            [memory],
                            isInactive(memory) ? "restore" : "archive",
                          )
                        }
                        onTag={(value) =>
                          setFilters({ ...filters, tag: value })
                        }
                      />
                    </Fragment>
                  ))}
                </ul>
              </div>
            ))
          )}
          {next && (
            <div className="mt-6 text-center">
              <button
                className="app-button secondary"
                disabled={loading}
                onClick={() => {
                  if (staleSearch) void query.refetch();
                  else void query.fetchNextPage();
                }}
              >
                {loading
                  ? "Loading…"
                  : view === "graph"
                    ? "Expand graph"
                    : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>
      {(notice || busy) && (
        <WorkspaceNotice>
          <span>{busy ? "Updating notes…" : notice}</span>
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
        </WorkspaceNotice>
      )}
      {selected && (
        <Dialog
          key={selected === "new" ? "new" : selected.id}
          panel
          title={selected === "new" ? "New note" : "Note"}
          busy={detailBusy}
          close={() => setSelected(null)}
        >
          {selected === "new" ? (
            <MemoryEditor
              projects={projects}
              projectId={scopedProject ?? null}
              cancel={() => setSelected(null)}
              done={() => reload("Note saved.")}
            />
          ) : (
            <MemoryDetail
              key={selected.id}
              memory={selected}
              projects={projects}
              busy={detailBusy}
              onSaved={setSelected}
              close={() => setSelected(null)}
              onDeleted={() => deleted(selected)}
              onMove={() => startMove([selected])}
              onArchive={() =>
                void perform(
                  [selected],
                  isInactive(selected) ? "restore" : "archive",
                )
              }
              onPrevious={
                currentIndex > 0
                  ? () => {
                      setDeleting(null);
                      setSelected(items[currentIndex - 1]);
                    }
                  : undefined
              }
              onNext={
                currentIndex >= 0 && currentIndex < items.length - 1
                  ? () => {
                      setDeleting(null);
                      setSelected(items[currentIndex + 1]);
                    }
                  : undefined
              }
            />
          )}
        </Dialog>
      )}
      {deleting && (
        <NoteDeleteDialog
          memories={deleting}
          close={() => setDeleting(null)}
          onDeleted={(gone) => deletedMany(gone)}
          onPendingChange={(ids, active) =>
            active ? markPending(ids) : unmarkPending(ids)
          }
        />
      )}
      {moving && (
        <Dialog
          title={`Move ${moving.length === 1 ? "note" : `${moving.length} notes`}`}
          close={() => setMoving(null)}
          busy={moveBusy}
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
              Choose a notebook. Your note and its history stay together.
            </p>
            {moving.length === 1 && moving[0].projectId === null && (
              <AssistanceAction
                compact
                disabled={moveBusy}
                input={{
                  kind: "filing",
                  sources: [{ id: moving[0].id, version: moving[0].version }],
                }}
              />
            )}
            <NotebookSelect
              label="Destination"
              value={destination}
              onValueChange={setDestination}
              projects={projects}
              leading={[
                ...(destination === ""
                  ? [
                      {
                        value: "",
                        label: "Choose a destination",
                        disabled: true,
                      },
                    ]
                  : []),
                { value: "personal", label: "Unfiled" },
              ]}
              disabled={moveBusy}
            />
            <p className="text-xs text-muted">
              Connected agents with access to this notebook can read these
              notes.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="app-button secondary"
                disabled={moveBusy}
                onClick={() => setMoving(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  moveBusy ||
                  !destination ||
                  moving.every(
                    (note) => (note.projectId ?? "personal") === destination,
                  )
                }
                className="app-button"
              >
                {moveBusy ? "Moving…" : "Move here"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
