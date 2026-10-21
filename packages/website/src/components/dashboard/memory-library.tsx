"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { X, Undo2, BookOpen, List, Network, CalendarDays } from "lucide-react";
import type { Memory, Page } from "@lib/shared/contracts";
import { api, errorMessage } from "@/lib/dashboard-api";
import {
  dateLabel,
  isInactive,
  memoryTitle,
  moveMemoryInput,
} from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { MemoryRow } from "./memory-row";
import { LibrarySelection } from "./library-selection";
import { MemoryEditor } from "./memory-editor";
import { MemoryDetail } from "./memory-detail";
import { useWorkspaceDrag } from "./memory-drag";
import { WorkspaceNotice } from "./toasts";
import {
  LibraryFilterBar,
  initialFilters,
  type LibraryFilters,
} from "./library-filters";
import { PageHeading } from "./ui/page-heading";
import { SegmentedControl } from "./ui/segmented-control";
import { Select } from "./ui/select";
import { NotebookSelect } from "./notebook-select";
import { useNotebooks, useSetCurrentNotebook } from "./notebooks-provider";
import { NoteDeleteDialog } from "./note-delete-dialog";
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
}) {
  const workspace = useWorkspaceDrag();
  const [view, setView] = useState(initialView);
  const [loadedItems, setItems] = useState<Memory[]>([]);
  const [resultKey, setResultKey] = useState("");
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
  const [searchMode, setSearchMode] = useState<string>();
  const [cursor, setNext] = useState<string | null>(null);
  const [fetching, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Memory | "new" | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const focusAfterDelete = useRef<string | null | undefined>(undefined);
  const [checked, setChecked] = useState<string[]>([]);
  const [actionRow, setActionRow] = useState<string | null>(null);
  const [moving, setMoving] = useState<Memory[] | null>(null);
  const [destination, setDestination] = useState("personal");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [listRef] = useAutoAnimate<HTMLUListElement>({ duration: 200 });
  const requests = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null);
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
    sourceAgent,
    updatedAfter,
    sort,
    lifetime,
  });
  useSetCurrentNotebook(scopedProject);
  const items = useMemo(
    () => (resultKey === requestKey ? loadedItems : []),
    [resultKey, requestKey, loadedItems],
  );
  const next = resultKey === requestKey ? cursor : null;
  const loading = fetching || resultKey !== requestKey;
  const currentError = resultKey === requestKey ? error : "";
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

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    api<Page<Memory>>(
      "/memories/search",
      {
        query: search || undefined,
        projectId: scopedProject,
        kind: kind || undefined,
        tag: tag || undefined,
        status,
        sourceAgent: sourceAgent || undefined,
        updatedAfter: updatedAfter || undefined,
        sort,
        lifetime: lifetime || undefined,
      },
      undefined,
      request.signal,
    )
      .then((page) => {
        if (request.signal.aborted) return;
        setError("");
        setChecked([]);
        setItems(page.items);
        setNext(page.nextCursor);
        setSearchMode(page.searchMode);
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
  }, [
    search,
    scopedProject,
    kind,
    tag,
    status,
    sourceAgent,
    updatedAfter,
    sort,
    lifetime,
    refresh,
    requestKey,
    workspace.revision,
  ]);
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
  function reload(message?: string) {
    setSelected(null);
    if (message) setNotice(message);
    setRefresh((value) => value + 1);
    workspace.refresh();
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
          sourceAgent: sourceAgent || undefined,
          updatedAfter: updatedAfter || undefined,
          sort,
          lifetime: lifetime || undefined,
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
      setNotice("Already in this notebook.");
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
        ? `${completed.length} ${completed.length === 1 ? "note" : "notes"} ${verb}.`
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
    const first = memories[0].projectId;
    setDestination(
      memories.every((note) => note.projectId === first)
        ? (first ?? "personal")
        : "",
    );
  }
  function deleted(memory: Memory) {
    const index = items.findIndex((item) => item.id === memory.id);
    const neighbor = items[index + 1] ?? items[index - 1];
    focusAfterDelete.current = neighbor?.id ?? null;
    setDeleting(null);
    setChecked((checked) => checked.filter((id) => id !== memory.id));
    setItems((items) => items.filter((item) => item.id !== memory.id));
    reload();
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
  const currentIndex =
    selected && selected !== "new"
      ? items.findIndex((m) => m.id === selected.id)
      : -1;
  return (
    <>
      {!embedded && (
        <PageHeading
          title={title}
          description={
            archive
              ? "Notes set aside. Restore them whenever you need."
              : initialView === "graph"
                ? "See how your ideas connect."
                : "Your notes, organized and connected."
          }
          actions={
            !archive && (
              <Link
                className="app-button secondary"
                href={`/app/notes/new?from=journal${scopedProject ? `&notebook=${encodeURIComponent(scopedProject)}` : ""}`}
              >
                <CalendarDays size={16} />
                Today’s note
              </Link>
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
            <span>
              {items.length}
              {next ? "+" : ""} {items.length === 1 && !next ? "note" : "notes"}
              {searchMode && search ? " found" : ""}
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
            <Select
              className={`library-sort${view === "list" ? "" : " library-sort-hidden"}`}
              disabled={view !== "list"}
              label="Sort"
              aria-label="Sort notes"
              value={sort}
              onValueChange={(value) =>
                setFilters({
                  ...filters,
                  sort: value as typeof sort,
                })
              }
              options={[
                { value: "updated_desc", label: "Recently updated" },
                { value: "updated_asc", label: "Oldest updated" },
                { value: "created_desc", label: "Date written" },
              ]}
            />
          </div>
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
            <p role="status" className="library-loading">
              Opening your notes…
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
                key={requestKey}
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
                    !busy &&
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
                  count={selectedItems.length}
                  allSelected={items
                    .slice(0, 50)
                    .every((memory) => checked.includes(memory.id))}
                  limited={items.length > 50}
                  busy={busy}
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
                />
                <ul ref={listRef}>
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
                        memory={memory}
                        actions={actionRow === memory.id}
                        setActions={(open) =>
                          setActionRow(open ? memory.id : null)
                        }
                        projectName={
                          projects.find((p) => p.id === memory.projectId)
                            ?.name ?? "Unfiled"
                        }
                        selected={checked.includes(memory.id)}
                        selectedItems={selectedItems}
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
                        onOpen={() => {
                          setDeleting(null);
                          setSelected(memory);
                        }}
                        onDelete={() => {
                          setDeleting(memory);
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
                onClick={loadMore}
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
          busy={busy}
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
              busy={busy}
              onSaved={(memory) => {
                setSelected(memory);
                setItems((items) =>
                  items.map((item) => (item.id === memory.id ? memory : item)),
                );
              }}
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
          memory={deleting}
          close={() => setDeleting(null)}
          onDeleted={() => deleted(deleting)}
        />
      )}
      {moving && (
        <Dialog
          title={`Move ${moving.length === 1 ? "note" : `${moving.length} notes`}`}
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
              Choose a notebook. Your note and its history stay together.
            </p>
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
              disabled={busy}
            />
            <p className="text-xs text-muted">
              Connected agents with access to this notebook can read these
              notes.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => setMoving(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  busy ||
                  !destination ||
                  moving.every(
                    (note) => (note.projectId ?? "personal") === destination,
                  )
                }
                className="app-button"
              >
                {busy ? "Moving…" : "Move here"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
