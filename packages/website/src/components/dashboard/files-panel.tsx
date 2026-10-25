"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Mic, ChevronDown } from "lucide-react";
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
import "./files.css";

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 ** 2 ? 1 : value < 1024 ** 3 ? 2 : 3;
  return `${(value / 1024 ** unit).toLocaleString("en", { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}
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
    return <Failure error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <p role="status">Loading locations…</p>;
  return (
    <div className="file-places">
      <ul aria-label={`Locations for ${file.filename}`}>
        {query.data.items.map((location) => (
          <li key={location.key}>
            <div>
              {location.memoryId ? (
                <>
                  <Link href={`/app/memories/${location.memoryId}`}>
                    {location.title}
                  </Link>
                  <p>
                    {location.projectId ? (
                      <Link href={`/app/projects/${location.projectId}`}>
                        {location.projectName ?? "Notebook"}
                      </Link>
                    ) : (
                      "Unfiled"
                    )}
                    {location.archived ? " · Archived note" : ""}
                    {location.historical ? " · Earlier note version" : ""}
                  </p>
                </>
              ) : location.conversationId ? (
                <>
                  <Link href={`/app/ask?chat=${location.conversationId}`}>
                    {location.title}
                  </Link>
                  <p>Ask Grove chat · No notebook unless saved as notes</p>
                </>
              ) : (
                <>
                  <span>{location.title}</span>
                  <p>
                    Not saved to a notebook yet. Continue from Import notes.
                  </p>
                </>
              )}
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
            <span>
              {file.kind === "document"
                ? "Document"
                : file.kind === "image"
                  ? "Image"
                  : "Recording"}{" "}
              ·{" "}
              {file.state === "staged"
                ? "Temporary upload"
                : file.state === "reserved"
                  ? "Storage reserved"
                  : "Retained original"}
              {file.status === "pending"
                ? " · Processing"
                : file.status === "failed"
                  ? " · Upload needs attention"
                  : ""}
            </span>
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
    initial.memoryId || initial.projectId || initial.conversationId;
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
      <section
        className="files-storage"
        aria-labelledby="files-storage-heading"
      >
        <h3 id="files-storage-heading">Upload storage</h3>
        {storage.error ? (
          <Failure error={storage.error} retry={() => void storage.refetch()} />
        ) : !usage ? (
          <p role="status">Loading storage…</p>
        ) : (
          <>
            <dl>
              <div>
                <dt>Retained upload budget</dt>
                <dd>
                  {bytes(usage.budgetBytes)}{" "}
                  <span>of {bytes(usage.byteLimit)}</span>
                </dd>
              </div>
              <div>
                <dt>Temporary staging</dt>
                <dd>
                  {bytes(usage.stagingBytes)}{" "}
                  <span>of {bytes(usage.stagingLimit)}</span>
                </dd>
              </div>
              <div>
                <dt>Accessible uploads</dt>
                <dd>
                  {usage.fileCount} {usage.fileCount === 1 ? "file" : "files"}{" "}
                  <span>
                    {bytes(usage.visibleBytes)} in available originals
                  </span>
                </dd>
              </div>
            </dl>
            <meter
              aria-label="Retained upload budget"
              value={usage.budgetBytes}
              max={usage.byteLimit}
            />
            <p>
              Includes retained and uncertain writes. Removing a file or
              deleting a note doesn’t free retained storage.
            </p>
          </>
        )}
        <details className="files-retention">
          <summary>What counts as storage?</summary>
          <p>
            {usage
              ? `${usage.attempts.toLocaleString()} of ${usage.attemptLimit.toLocaleString()} upload attempts used. `
              : ""}
            The retained budget includes uncertain or repeated writes, not just
            the files below. Accessible uploads also include temporary files.
            Accepted documents, note images and original recordings are retained
            privately. Unaccepted document uploads expire after 24 hours;
            staging is released after cleanup. Read-aloud audio and export
            archives are separate temporary data, not uploaded files. Images and
            recordings use generated names because their original filenames
            weren’t stored.
          </p>
        </details>
      </section>
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
              : initial.projectId
                ? "notes directly in this notebook (not sub-notebooks)"
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
            Filename
            <input
              type="search"
              placeholder="Search uploads…"
              maxLength={200}
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </label>
          <label>
            File type
            <select
              aria-label="File type"
              value={filters.kind ?? ""}
              onChange={(event) => {
                setCursors([undefined]);
                setFilters((old) => ({
                  ...old,
                  kind: (event.target.value || undefined) as FileSearch["kind"],
                }));
              }}
            >
              <option value="">All types</option>
              <option value="document">Documents</option>
              <option value="image">Images</option>
              <option value="recording">Recordings</option>
            </select>
          </label>
          <button type="submit" className="app-button secondary">
            Search files
          </button>
        </form>
        {files.error ? (
          <Failure error={files.error} retry={() => void files.refetch()} />
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
                  {filters.query || filters.kind || scoped
                    ? "Try another filename or type, or view all uploads."
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
      ["query", "kind", "memoryId", "projectId", "conversationId"].flatMap(
        (key) => (params.get(key) ? [[key, params.get(key)]] : []),
      ),
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
