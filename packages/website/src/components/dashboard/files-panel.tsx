"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Image as ImageIcon,
  Mic,
  ChevronDown,
  SlidersHorizontal,
  X,
  Folder,
  MessageSquare,
  BookOpen,
} from "lucide-react";
import {
  fileSearchSchema,
  type FileSearch,
  type FilePage,
  type FileStorage,
  type FileLocations,
  type UploadedFile,
} from "@lib/shared/files";
import { useWorkspaceCache } from "./workspace-cache";
import { errorMessage } from "@/lib/dashboard-api";
import { workspaceKeys } from "@/lib/workspace-cache";
import {
  FilesStorageSummary,
  fileBytes as bytes,
} from "./files-storage-summary";
import { NotebookSelect } from "./notebook-select";
import { useNotebooks } from "./notebooks-provider";
import { NotebookBreadcrumbs } from "./notebook-breadcrumbs";
import { memoryExcerpt } from "@/lib/memory-display";
import "./files.css";

const viewLabels: Record<FileSearch["view"], string> = {
  all: "All files",
  temporary: "Temporary uploads",
  attention: "Needs attention",
  chat_only: "Only in chats",
  unfiled: "Unfiled notes",
  history: "Earlier note versions",
};
const typeLabels = {
  document: "Documents",
  image: "Images",
  recording: "Recordings",
};
function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="app-error" role="alert">
      <p>{errorMessage(error)}</p>
      <button type="button" className="text-button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
function FilePlaces({ file }: { file: UploadedFile }) {
  const { projects } = useNotebooks();
  const cache = useWorkspaceCache(),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useQuery({
    ...cache.resource<FileLocations>("/files/locations", {
      source: file.source,
      id: file.id,
      after: cursors.at(-1),
    }),
    staleTime: 0,
    refetchInterval: 30000,
  });
  if (query.error)
    return (
      <>
        <Failure error={query.error} retry={() => void query.refetch()} />
        {cursors.length > 1 ? (
          <button
            className="text-button"
            onClick={() => setCursors([undefined])}
          >
            Start from first location
          </button>
        ) : null}
      </>
    );
  if (!query.data) return <p role="status">Loading locations…</p>;
  return (
    <div className="file-places">
      <ul aria-label={`Locations for ${file.filename}`}>
        {query.data.items.map((location) => (
          <li key={location.key}>
            {location.memoryId ? (
              <BookOpen size={16} aria-hidden="true" />
            ) : location.conversationId ? (
              <MessageSquare size={16} aria-hidden="true" />
            ) : (
              <Folder size={16} aria-hidden="true" />
            )}
            <div>
              {location.memoryId ? (
                <>
                  <Link href={`/app/memories/${location.memoryId}`}>
                    {memoryExcerpt({ content: location.title }, 110) ||
                      "Untitled note"}
                  </Link>
                  <p>
                    {!location.projectId ? "Unfiled" : ""}
                    {location.archived ? " · Archived note" : ""}
                    {location.historical ? " · Earlier note version" : ""}
                  </p>
                  {location.projectId ? (
                    projects.some((p) => p.id === location.projectId) ? (
                      <NotebookBreadcrumbs
                        projects={projects}
                        id={location.projectId}
                      />
                    ) : (
                      <Link
                        className="file-notebook-fallback"
                        href={`/app/projects/${location.projectId}`}
                      >
                        {location.projectName ?? "Notebook"}
                      </Link>
                    )
                  ) : null}
                </>
              ) : location.conversationId ? (
                <>
                  <Link href={`/app/ask?chat=${location.conversationId}`}>
                    {location.title}
                  </Link>
                  <p>Ask Grove chat · Separate from your notebooks</p>
                </>
              ) : (
                <>
                  <span>{location.title}</span>
                  <p>
                    Not saved to a notebook yet. Continue from Import notes.
                  </p>
                </>
              )}
              {!location.downloadPath && location.memoryId ? (
                <p>
                  The original isn’t available until the upload and note save
                  finish.
                </p>
              ) : null}
            </div>
            {location.downloadPath ? (
              <a
                className="text-button"
                href={`/api/grove${location.downloadPath}`}
                download
              >
                Download original
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {!query.data.items.length ? (
        <p>No accessible locations remain. Refresh files to update the list.</p>
      ) : null}
      <div className="files-paging">
        {cursors.length > 1 ? (
          <button
            type="button"
            className="text-button"
            onClick={() => setCursors((old) => old.slice(0, -1))}
          >
            Previous locations
          </button>
        ) : null}
        {query.data.nextCursor ? (
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setCursors((old) => [...old, query.data!.nextCursor!])
            }
          >
            More locations
          </button>
        ) : null}
      </div>
    </div>
  );
}
function FileRow({ file }: { file: UploadedFile }) {
  const [open, setOpen] = useState(false);
  const Icon =
    file.kind === "image"
      ? ImageIcon
      : file.kind === "recording"
        ? Mic
        : FileText;
  return (
    <li className="file-row">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <Icon size={19} aria-hidden="true" />
          <span className="file-name">
            <strong>{file.filename}</strong>
            <span className="file-meta">
              {file.kind === "document"
                ? "Document"
                : file.kind === "image"
                  ? "Image"
                  : "Recording"}{" "}
              · Uploaded{" "}
              {new Date(file.createdAt).toLocaleDateString("en", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </span>
          <span
            className="file-state"
            data-state={file.status === "failed" ? "attention" : file.state}
          >
            {file.status === "failed"
              ? "Needs attention"
              : file.status === "pending"
                ? "Processing"
                : file.state === "staged"
                  ? "Temporary"
                  : file.state === "reserved"
                    ? "Pending save"
                    : "Saved original"}
          </span>
          <span className="file-size">{bytes(file.bytes)}</span>
          <span className="file-location-count">
            {file.locationCount}{" "}
            {file.locationCount === 1 ? "location" : "locations"}
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </summary>
        {open ? (
          <div className="file-expanded">
            <p className="file-date">
              Uploaded{" "}
              {new Date(file.createdAt).toLocaleDateString("en", {
                dateStyle: "medium",
              })}
              {file.expiresAt
                ? ` · Unaccepted upload expires ${new Date(file.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}`
                : ""}
            </p>
            <FilePlaces file={file} />
            {file.source === "media" ? (
              <p className="file-date">
                This is a generated filename; the original filename wasn’t
                stored.
              </p>
            ) : null}
          </div>
        ) : null}
      </details>
    </li>
  );
}
function FilesView({ initial }: { initial: FileSearch }) {
  const cache = useWorkspaceCache(),
    [queryText, setQueryText] = useState(initial.query),
    [filters, setFilters] = useState(initial);
  const notebooks = useNotebooks();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const change = (patch: Partial<FileSearch>) => {
    setCursors([undefined]);
    setFilters((old) => ({ ...old, ...patch }));
  };
  const clear = () => {
    setQueryText("");
    setCursors([undefined]);
    setFilters({
      query: "",
      sort: "newest",
      view: "all",
      memoryId: initial.memoryId,
      conversationId: initial.conversationId,
    });
  };
  const activeCount =
    Number(!!filters.kind) +
    Number(filters.view !== "all") +
    Number(!!filters.projectId);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const storage = useQuery({
    ...cache.resource<FileStorage>("/files/storage"),
    staleTime: 0,
    refetchInterval: 30000,
  });
  const files = useQuery({
    ...cache.resource<FilePage>("/files/search", {
      ...filters,
      after: cursors.at(-1),
    }),
    staleTime: 0,
    refetchInterval: 30000,
  });
  const scoped =
    filters.memoryId || filters.projectId || filters.conversationId;
  const notebookName =
    notebooks.projects.find((p) => p.id === filters.projectId)?.name ??
    "Selected notebook";
  const usage = storage.error ? undefined : storage.data;
  return (
    <div className="settings-content files-panel">
      <div className="files-heading">
        <div>
          <h2 className="settings-section-heading">Files &amp; storage</h2>
          <p className="settings-section-description">
            Your uploaded documents, images and recordings, and where they’re
            used.
          </p>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={files.isFetching || storage.isFetching}
          onClick={() => {
            void files.refetch();
            void storage.refetch();
            void cache.client.invalidateQueries({
              queryKey: workspaceKeys.resource("/files/locations").slice(0, -1),
            });
          }}
        >
          Refresh files
        </button>
      </div>
      {storage.error ? (
        <Failure error={storage.error} retry={() => void storage.refetch()} />
      ) : usage ? (
        <FilesStorageSummary usage={usage} />
      ) : (
        <p role="status">Loading storage…</p>
      )}
      <section aria-labelledby="files-list-heading">
        <div className="files-list-heading">
          <h3 id="files-list-heading">Uploaded files</h3>
          {scoped ? (
            <Link className="text-button" href="/app/settings/files">
              All uploads
            </Link>
          ) : null}
        </div>
        {scoped ? (
          <p className="files-scope">
            Showing files used by{" "}
            {initial.memoryId
              ? "this note"
              : filters.projectId
                ? `notes directly in ${notebookName} (not sub-notebooks)`
                : "this chat"}
            . Storage totals cover your whole account.
          </p>
        ) : null}
        <form
          className="files-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setCursors([undefined]);
            setFilters((old) => ({ ...old, query: queryText.trim() }));
          }}
        >
          <label>
            Search files
            <input
              type="search"
              placeholder="Filename, note, notebook or chat…"
              maxLength={200}
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </label>
          <button
            type="submit"
            aria-label="Search files"
            className="app-button secondary"
          >
            Search
          </button>
        </form>
        <div className="files-toolbar">
          <button
            type="button"
            className="files-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="files-filter-options"
            onClick={() => setFiltersOpen((old) => !old)}
          >
            <SlidersHorizontal size={16} />
            Filters{activeCount ? ` (${activeCount})` : ""}
          </button>
          <label className="files-sort">
            Sort by
            <select
              aria-label="Sort by"
              value={filters.sort}
              onChange={(event) =>
                change({ sort: event.target.value as FileSearch["sort"] })
              }
            >
              <option value="newest">Newest first</option>
              <option value="name">Filename A–Z</option>
              <option value="size">Largest first</option>
            </select>
          </label>
        </div>
        <div
          id="files-filter-options"
          className="files-filter-grid"
          hidden={!filtersOpen}
        >
          <label>
            File type
            <select
              aria-label="File type"
              value={filters.kind ?? ""}
              onChange={(event) =>
                change({
                  kind: (event.target.value || undefined) as FileSearch["kind"],
                })
              }
            >
              <option value="">All types</option>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show
            <select
              aria-label="Show files"
              value={filters.view}
              onChange={(event) =>
                change({
                  view: event.target.value as FileSearch["view"],
                  ...(event.target.value === "unfiled"
                    ? { projectId: undefined }
                    : {}),
                })
              }
            >
              {Object.entries(viewLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="files-notebook-filter">
            <span>Notebook</span>
            <NotebookSelect
              aria-label="Filter by notebook"
              projects={notebooks.projects}
              leading={[
                { value: "", label: "All notebooks" },
                ...(filters.projectId &&
                !notebooks.projects.some((p) => p.id === filters.projectId)
                  ? [{ value: filters.projectId, label: notebookName }]
                  : []),
              ]}
              value={filters.projectId ?? ""}
              onValueChange={(projectId) =>
                change({
                  projectId: projectId || undefined,
                  view: filters.view === "unfiled" ? "all" : filters.view,
                })
              }
            />
          </div>
          {notebooks.error ? (
            <div className="files-filter-error">
              <p>
                Notebook filters are unavailable. Your file list is still
                available.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={notebooks.reload}
              >
                Retry notebooks
              </button>
            </div>
          ) : null}
        </div>
        {activeCount > 0 || filters.query ? (
          <div
            className="files-active-filters"
            aria-label="Active file filters"
          >
            {filters.query ? (
              <button
                type="button"
                onClick={() => {
                  setQueryText("");
                  change({ query: "" });
                }}
              >
                <span>Search: {filters.query}</span>
                <X size={13} />
                <span className="sr-only">Clear search</span>
              </button>
            ) : null}
            {filters.kind ? (
              <button type="button" onClick={() => change({ kind: undefined })}>
                {typeLabels[filters.kind]}
                <X size={13} />
                <span className="sr-only">Clear file type</span>
              </button>
            ) : null}
            {filters.view !== "all" ? (
              <button type="button" onClick={() => change({ view: "all" })}>
                {viewLabels[filters.view]}
                <X size={13} />
                <span className="sr-only">Clear file view</span>
              </button>
            ) : null}
            {filters.projectId ? (
              <button
                type="button"
                onClick={() => change({ projectId: undefined })}
              >
                <span>{notebookName}</span>
                <X size={13} />
                <span className="sr-only">Clear notebook filter</span>
              </button>
            ) : null}
            <button type="button" className="text-button" onClick={clear}>
              Clear filters
            </button>
          </div>
        ) : null}
        {files.error ? (
          <>
            <Failure error={files.error} retry={() => void files.refetch()} />
            {cursors.length > 1 ? (
              <button
                type="button"
                className="text-button"
                onClick={() => setCursors([undefined])}
              >
                Start from first page
              </button>
            ) : null}
          </>
        ) : !files.data ? (
          <p role="status">Loading files…</p>
        ) : (
          <>
            <p className="files-page-status" role="status">
              {files.data.items.length
                ? `Page ${cursors.length} · ${files.data.items.length} uploads shown`
                : "No matching uploads"}
            </p>
            {files.data.items.length ? (
              <ul className="file-ledger" aria-label="Uploaded files">
                {files.data.items.map((file) => (
                  <FileRow key={`${file.source}:${file.id}`} file={file} />
                ))}
              </ul>
            ) : (
              <div className="files-empty">
                <p>
                  {filters.query || activeCount || scoped
                    ? "Try another search or clear your filters to find more files."
                    : "Upload a document in Ask Grove or Import notes, or add an image or recording to a note. Your files will appear here."}
                </p>
                <Link className="text-button" href="/app/ask">
                  Open Ask Grove
                </Link>
                <Link className="text-button" href="/app/settings/data">
                  Import notes
                </Link>
              </div>
            )}
            <div className="files-paging">
              <button
                type="button"
                className="text-button"
                disabled={cursors.length === 1 || files.isFetching}
                onClick={() => setCursors((old) => old.slice(0, -1))}
              >
                Previous files
              </button>
              <button
                type="button"
                className="text-button"
                disabled={!files.data.nextCursor || files.isFetching}
                onClick={() =>
                  setCursors((old) => [...old, files.data!.nextCursor!])
                }
              >
                Next files
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
export function FilesPanel() {
  const params = useSearchParams();
  const parsed = fileSearchSchema.safeParse(
    Object.fromEntries(
      [
        "query",
        "kind",
        "sort",
        "view",
        "memoryId",
        "projectId",
        "conversationId",
      ].flatMap((key) => (params.get(key) ? [[key, params.get(key)]] : [])),
    ),
  );
  if (!parsed.success)
    return (
      <div className="settings-content">
        <h2 className="settings-section-heading">Files &amp; storage</h2>
        <p role="alert">This file filter is invalid.</p>
        <Link href="/app/settings/files">View all uploads</Link>
      </div>
    );
  return <FilesView key={params.toString()} initial={parsed.data} />;
}
