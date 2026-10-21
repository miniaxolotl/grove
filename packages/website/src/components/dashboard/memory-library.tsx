"use client";
import { Fragment, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Archive,
  FolderInput,
  X,
  Undo2,
  BookOpen,
  List,
  Network,
  CalendarDays,
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
import { MemoryRow } from "./memory-row";
import { deferredFeature } from "./deferred-feature";
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
const loadDetail = () =>
  import("./memory-detail").then((module) => ({
    default: module.MemoryDetail,
  }));
const MemoryDetail = deferredFeature(
  loadDetail,
  "Opening your note…",
  "note-editor-drawer",
);
const MemoryEditor = deferredFeature(
  async () => ({ default: (await import("./memory-editor")).MemoryEditor }),
  "Opening your writing space…",
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
  const cache = useWorkspaceCache();
  const api = cache.api;
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
  const [deleting, setDeleting] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [moving, setMoving] = useState<Memory[] | null>(null);
  const [destination, setDestination] = useState("personal");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [listRef] = useAutoAnimate<HTMLUListElement>({ duration: 200 });
  const requests = useRef(new Map<string, string>());
  const scopedProject =
    fixedProject !== undefined
      ? fixedProject
      : project === "all"
        ? undefined
        : project === "personal"
          ? null
          : project;
  const query = useInfiniteQuery(
    cache.notes({
      query: search,
      projectId: scopedProject,
      kind: (kind || undefined) as MemoryList["kind"],
      tag: tag || undefined,
      status: status as MemoryList["status"],
      sourceAgent: (sourceAgent || undefined) as MemoryList["sourceAgent"],
      updatedAfter: updatedAfter || undefined,
      sort,
      lifetime: (lifetime || undefined) as MemoryList["lifetime"],
    }),
  );
  useSetCurrentNotebook(scopedProject);
  const items = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((note) => [note.id, note]),
    ).values(),
  ];
  const next = query.hasNextPage;
  const loading = query.isPending || query.isFetchingNextPage;
  const searchMode = query.data?.pages[0]?.searchMode;
  const currentError = error || (query.error ? errorMessage(query.error) : "");
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
    setDestination("personal");
  }
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
            {view === "list" && (
              <Select
                className="library-sort"
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
            )}
          </div>
          {view === "list" && selectedItems.length > 0 && (
            <div
              className="selection-toolbar"
              role="group"
              aria-label="Selected notes"
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
                items={items}
                projects={projects}
                onOpen={setSelected}
              />
            ) : (
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
                  Select these notes
                  {items.length > 50 ? " (first 50)" : ""}
                </label>
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
                          setDeleting(false);
                          setSelected(memory);
                        }}
                        onDelete={() => {
                          setDeleting(true);
                          setSelected(memory);
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
                onClick={() => void query.fetchNextPage()}
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
        <div className="workspace-notice" role="status">
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
        </div>
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
              initialDelete={deleting}
              busy={busy}
              onSaved={setSelected}
              close={() => setSelected(null)}
              onDeleted={() => reload()}
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
                      setDeleting(false);
                      setSelected(items[currentIndex - 1]);
                    }
                  : undefined
              }
              onNext={
                currentIndex >= 0 && currentIndex < items.length - 1
                  ? () => {
                      setDeleting(false);
                      setSelected(items[currentIndex + 1]);
                    }
                  : undefined
              }
            />
          )}
        </Dialog>
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
              leading={[{ value: "personal", label: "Unfiled" }]}
              disabled={busy}
            />
            <p className="text-xs text-muted">
              Connected agents with access to this notebook can read these
              notes.
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
