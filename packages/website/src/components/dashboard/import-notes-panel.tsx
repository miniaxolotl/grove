"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspaceSearch } from "./workspace-search";
import type { Conversation } from "@lib/shared/conversations";
import { FileText, Upload } from "lucide-react";
import type {
  ImportBatch,
  ImportDestination,
} from "@lib/shared/document-imports";
import type { Task } from "@lib/shared/jobs";
import { errorMessage } from "@/lib/dashboard-api";
import { workspaceKeys } from "@/lib/workspace-cache";
import { useWorkspaceCache } from "./workspace-cache";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import { Button } from "./ui/button";
import { useDialogBusy } from "./dialog";
import "./import-notes.css";

type Draft = ImportBatch["notes"][number];
const active = (task?: Task) =>
  !task || task.status === "pending" || task.status === "running";
const failures: Record<string, string> = {
  document_pdf: "PDF couldn’t be read. Try an unlocked, text-based PDF.",
  document_docx:
    "DOCX couldn’t be read. Try a standard Word document without macros.",
  document_empty: "No readable text. Scanned PDFs need OCR before import.",
  document_encoding: "Save this text file as UTF-8 and try again.",
  document_binary: "This isn’t a plain text file.",
  document_type: "File contents don’t match its type.",
  document_text_limit: "Extracted text exceeds 1 MiB.",
  import_note_limit: "This file would exceed the 500-note batch limit.",
};

function Destination({
  value,
  onChange,
  disabled,
}: {
  value: ImportDestination;
  onChange: (value: ImportDestination) => void;
  disabled?: boolean;
}) {
  const { projects } = useNotebooks();
  const selected = value
    ? "projectId" in value
      ? value.projectId
      : "new"
    : "";
  return (
    <div className="import-destination">
      <NotebookSelect
        projects={projects}
        aria-label="Destination notebook"
        value={selected}
        disabled={disabled}
        leading={[
          { value: "", label: "Unfiled" },
          { value: "new", label: "New notebook…" },
        ]}
        onValueChange={(id) => {
          const project = projects.find((p) => p.id === id);
          onChange(
            id === "new"
              ? { name: "Imported notes", parentId: null }
              : project
                ? { projectId: project.id, version: project.version ?? 1 }
                : null,
          );
        }}
      />
      {value && "name" in value && (
        <>
          <label>
            Notebook name
            <input
              aria-label="New notebook name"
              maxLength={100}
              value={value.name}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, name: event.target.value })
              }
            />
          </label>
          <NotebookSelect
            projects={projects}
            aria-label="Parent notebook"
            value={value.parentId ?? ""}
            leading={[{ value: "", label: "No parent notebook" }]}
            disabled={disabled}
            onValueChange={(parentId) =>
              onChange({ ...value, parentId: parentId || null })
            }
          />
        </>
      )}
    </div>
  );
}

function DraftReview({
  note,
  filename,
  busy,
  save,
  onDirty,
}: {
  note: Draft;
  filename: string;
  busy: boolean;
  save: (note: Draft, edit: Record<string, unknown>) => Promise<void>;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const { projects } = useNotebooks();
  const assigned = note.destination;
  const destinationLabel = assigned
    ? "name" in assigned
      ? `New notebook: ${assigned.name}`
      : `Notebook: ${projects.find((project) => project.id === assigned.projectId)?.name ?? "Unavailable"}`
    : "Unfiled";
  const [base, setBase] = useState(note);
  const [content, setContent] = useState(note.content);
  const [destination, setDestination] = useState(note.destination);
  if (base !== note) {
    setBase(note);
    if (
      content === base.content &&
      JSON.stringify(destination) === JSON.stringify(base.destination)
    ) {
      setContent(note.content);
      setDestination(note.destination);
    }
  }
  const dirty =
    content !== note.content ||
    JSON.stringify(destination) !== JSON.stringify(note.destination);
  useEffect(() => {
    onDirty(note.id, dirty);
    return () => onDirty(note.id, false);
  }, [note.id, dirty, onDirty]);
  return (
    <article className="import-draft">
      <label className="import-include">
        <input
          type="checkbox"
          checked={note.included}
          disabled={busy}
          onChange={(event) =>
            void save(note, { included: event.target.checked })
          }
        />
        <span>
          {filename}
          <small>
            Part {note.ordinal + 1}
            {/\.pdf$/i.test(filename) &&
              (note.pageStart === note.pageEnd
                ? ` · Page ${note.pageStart}`
                : ` · Pages ${note.pageStart}–${note.pageEnd}`)}
          </small>
        </span>
      </label>
      <p className="import-small">{destinationLabel}</p>
      <details>
        <summary>Review note and destination</summary>
        <label>
          Note content
          <textarea
            aria-label={`Content from ${filename}`}
            rows={6}
            maxLength={6000}
            value={content}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <p className="import-small">
          {content.length.toLocaleString()} / 6,000 characters
        </p>
        <Destination
          value={destination}
          onChange={setDestination}
          disabled={busy}
        />
        {note.suggestion && (
          <p className="import-small">Suggested: {note.suggestion}</p>
        )}
        <Button
          disabled={
            busy ||
            !dirty ||
            !content.trim() ||
            (!!destination && "name" in destination && !destination.name.trim())
          }
          onClick={() => void save(note, { content, destination })}
        >
          Save reviewed note
        </Button>
        {dirty && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setContent(note.content);
              setDestination(note.destination);
            }}
          >
            Discard edits
          </Button>
        )}
      </details>
    </article>
  );
}

export function ImportNotesPanel({
  projectId,
  initialBatchId,
}: {
  projectId?: string;
  initialBatchId?: string;
}) {
  const cache = useWorkspaceCache(),
    { projects } = useNotebooks();
  const workspace = useWorkspaceSearch(),
    router = useRouter();
  const handoff = useRef<{ id: string; expectedVersion: number } | null>(null);
  const [id, setId] = useState(initialBatchId ?? "");
  const [after, setAfter] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [placement, setPlacement] = useState<ImportDestination>(() => {
    const p = projects.find((p) => p.id === projectId);
    return p ? { projectId: p.id, version: p.version ?? 1 } : null;
  });
  const [reviewed, setReviewed] = useState(false);
  const [dirtyNotes, setDirtyNotes] = useState<Set<string>>(() => new Set());
  const dialogBusy = useDialogBusy();
  const dirty = dirtyNotes.size > 0;
  const onDirty = useCallback(
    (noteId: string, value: boolean) =>
      setDirtyNotes((current) => {
        if (current.has(noteId) === value) return current;
        const next = new Set(current);
        if (value) next.add(noteId);
        else next.delete(noteId);
        return next;
      }),
    [],
  );
  useEffect(() => {
    dialogBusy(busy || dirty);
    return () => dialogBusy(false);
  }, [dialogBusy, busy, dirty]);
  const chooser = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const upload = useRef<{
    id: string;
    files: { id: string; file: File }[];
  } | null>(null);
  const confirm = useRef<{ id: string; expectedVersion: number } | null>(null);
  const suggestion = useRef<{ id: string; expectedVersion: number } | null>(
    null,
  );
  const prepareId = useRef(crypto.randomUUID());
  const lastTask = useRef<Task | undefined>(undefined);
  const list = useQuery({
    ...cache.resource<{ id: string; status: string; createdAt: string }[]>(
      "/import-batches",
    ),
    enabled: !id,
  });
  const path = `/import-batches/${id}${after ? `?after=${after}` : ""}`;
  const query = useQuery({
    ...cache.resource<ImportBatch>(path),
    enabled: !!id,
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data &&
      ["preparing", "applying"].includes(q.state.data.status) &&
      (lastTask.current?.id !== q.state.data.taskId || active(lastTask.current))
        ? 1500
        : false,
  });
  const batch = query.data;
  const task = useQuery({
    ...cache.resource<Task>(`/tasks/${batch?.taskId ?? "pending"}`),
    enabled: !!batch?.taskId,
    refetchInterval: (q) => (active(q.state.data) ? 1500 : false),
    staleTime: 0,
  });
  useEffect(() => {
    lastTask.current = task.data;
  }, [task.data]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!batch?.imported) return;
    void cache.client.invalidateQueries({
      queryKey: [...workspaceKeys.root, "notes"],
    });
    void cache.client.invalidateQueries({
      queryKey: workspaceKeys.resource("/projects"),
    });
  }, [batch?.imported, cache]);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    await query.refetch();
    if (batch?.taskId) await task.refetch();
    setReviewed(false);
  }
  async function sendFiles(files: File[]) {
    if (
      files.length > 25 ||
      files.some(
        (file) =>
          !file.size ||
          file.size > 3 * 1024 * 1024 ||
          !/\.(md|markdown|txt|pdf|docx)$/i.test(file.name),
      )
    ) {
      setError(
        "Choose up to 25 PDF, DOCX, Markdown or text files, each no larger than 3 MiB.",
      );
      return;
    }
    upload.current = {
      id: id || crypto.randomUUID(),
      files: files.map((file) => ({ id: crypto.randomUUID(), file })),
    };
    await retryUpload();
  }
  async function retryUpload() {
    await run(async () => {
      const pending = upload.current;
      if (!pending) return;
      controller.current = new AbortController();
      const signal = controller.current.signal;
      if (!id) {
        await cache.api("/import-batches", { id: pending.id });
        setId(pending.id);
      }
      for (let index = 0; index < pending.files.length; index++) {
        const entry = pending.files[index];
        setMessage(
          `Uploading ${index + 1} of ${pending.files.length}: ${entry.file.name}`,
        );
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await entry.file.arrayBuffer(),
        );
        signal.throwIfAborted();
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const response = await fetch(
          `/api/grove/import-batches/${pending.id}/files/${entry.id}`,
          {
            method: "PUT",
            credentials: "same-origin",
            cache: "no-store",
            signal,
            body: entry.file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Grove-Filename": encodeURIComponent(entry.file.name),
              "X-Grove-Content-Sha256": sha256,
              "X-Grove-Telemetry": "off",
            },
          },
        );
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(
            result.error?.message ?? "Upload failed. Retry this upload.",
          );
      }
      upload.current = null;
      await cache.api(`/import-batches/${pending.id}/prepare`, {
        id: prepareId.current,
      });
      setMessage("");
      await cache.client.invalidateQueries({
        queryKey: workspaceKeys.resource(`/import-batches/${pending.id}`),
      });
    });
  }
  async function edit(note: Draft, values: Record<string, unknown>) {
    await run(async () => {
      await cache.api(
        `/import-batches/${id}/notes/${note.id}`,
        { expectedVersion: batch!.version, ...values },
        "PATCH",
      );
      await refresh();
    });
  }
  const mutable = batch?.status === "ready";
  const running = batch && ["preparing", "applying"].includes(batch.status);
  return (
    <div className="import-notes">
      <p>
        Upload your notes, review the content and choose their notebooks before
        importing.
      </p>
      <p className="import-small">
        Markdown, text, DOCX and text-based PDFs. Up to 25 files, 3 MiB each.
        PDF layouts may need correction; images and attachments aren’t imported.
      </p>
      {(error || query.error || list.error) && (
        <div className="app-error" role="alert">
          <p>{error || errorMessage(query.error ?? list.error)}</p>
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                await query.refetch();
                await list.refetch();
              })
            }
          >
            Reload import
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {busy && upload.current && (
        <Button variant="secondary" onClick={() => controller.current?.abort()}>
          Stop upload
        </Button>
      )}
      {(!id || batch?.status === "uploading") && (
        <>
          <div
            className="import-drop"
            onDragOver={(event) => {
              if (!busy) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void sendFiles([...event.dataTransfer.files]);
            }}
          >
            <Upload size={22} aria-hidden="true" />
            <p>Drop your notes here</p>
            <Button disabled={busy} onClick={() => chooser.current?.click()}>
              Choose files
            </Button>
            <input
              ref={chooser}
              type="file"
              multiple
              accept=".md,.markdown,.txt,.pdf,.docx"
              className="sr-only"
              aria-label="Upload notes and PDFs"
              disabled={busy}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length) void sendFiles(files);
                event.target.value = "";
              }}
            />
          </div>
          {upload.current && (
            <Button disabled={busy} onClick={() => void retryUpload()}>
              Retry upload
            </Button>
          )}
          {!id && list.data?.length ? (
            <section aria-label="Recent imports">
              <h3>Recent imports</h3>
              {list.data.map((entry) => (
                <button
                  key={entry.id}
                  className="text-button"
                  onClick={() => {
                    setId(entry.id);
                    setAfter(undefined);
                    setHistory([]);
                  }}
                >
                  {entry.status === "complete"
                    ? "View imported notes"
                    : "Resume import"}{" "}
                  · {new Date(entry.createdAt).toLocaleDateString()}
                </button>
              ))}
            </section>
          ) : null}
        </>
      )}
      {batch && (
        <>
          {batch.status === "ready" &&
            !initialBatchId &&
            batch.files.length > 0 &&
            batch.files.every(
              (file) => file.status === "ready" && !file.originalReady,
            ) && (
              <div className="import-actions">
                <Button
                  variant="secondary"
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      if (handoff.current?.expectedVersion !== batch.version)
                        handoff.current = {
                          id: crypto.randomUUID(),
                          expectedVersion: batch.version,
                        };
                      const chat = await cache.api<Conversation>(
                        `/import-batches/${id}/conversation`,
                        handoff.current,
                      );
                      workspace?.sessions.set("ask:global", {
                        scope: "all",
                        includePersonal: false,
                        draft: "",
                        conversationId: chat.id,
                        query: "",
                        mode: "answer",
                      });
                      router.push("/app/ask");
                    })
                  }
                >
                  Ask about these documents
                </Button>
                <p className="import-small">
                  Continue in a private chat without saving notes or uploading
                  again. This review stays available.
                </p>
              </div>
            )}
          <ul className="import-files" aria-label="Uploaded files">
            {batch.files.map((file) => (
              <li key={file.id}>
                <FileText size={17} aria-hidden="true" />
                <div>
                  <strong>{file.filename}</strong>
                  <span>
                    {file.error
                      ? (failures[file.error] ??
                        "File couldn’t be read. Try another file.")
                      : file.pages
                        ? /\.pdf$/i.test(file.filename)
                          ? `${file.pages} page${file.pages === 1 ? "" : "s"}`
                          : "Text file"
                        : "Uploaded"}
                  </span>
                  {!!file.emptyPages.length && (
                    <span className="import-warning">
                      No text on pages {file.emptyPages.join(", ")}. Review the
                      remaining text before importing.
                    </span>
                  )}
                  {file.originalReady && (
                    <a
                      href={`/api/grove/import-batches/${id}/files/${file.id}/original`}
                    >
                      Download original
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {batch.status === "uploading" && (
            <Button
              disabled={busy || !batch.files.length || !!upload.current}
              onClick={() =>
                void run(async () => {
                  await cache.api(`/import-batches/${id}/prepare`, {
                    id: prepareId.current,
                  });
                  await refresh();
                  setMessage("");
                })
              }
            >
              Prepare import
            </Button>
          )}
          {running && (
            <section aria-live="polite">
              <h3>
                {batch.status === "preparing"
                  ? "Preparing your notes"
                  : "Importing your notes"}
              </h3>
              <p>
                {task.data?.processed ?? 0} /{" "}
                {task.data?.total ?? batch.files.length} processed. You can
                close this dialog and return later.
              </p>
              {task.data?.status === "failed" && (
                <>
                  <p className="app-error">
                    Processing stopped: {task.data.error}. Already imported
                    notes are kept.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await cache.api(`/tasks/${batch.taskId}/retry`, {});
                        await refresh();
                      })
                    }
                  >
                    Retry remaining work
                  </Button>
                </>
              )}
            </section>
          )}
          {mutable && (
            <>
              <section className="import-placement">
                <h3>Choose where these notes belong</h3>
                <Destination
                  value={placement}
                  onChange={setPlacement}
                  disabled={busy}
                />
                <div className="import-actions">
                  <Button
                    variant="secondary"
                    disabled={
                      busy ||
                      dirty ||
                      (!!placement &&
                        "name" in placement &&
                        !placement.name.trim())
                    }
                    onClick={() =>
                      void run(async () => {
                        await cache.api(
                          `/import-batches/${id}/placement`,
                          {
                            expectedVersion: batch.version,
                            destination: placement,
                          },
                          "PATCH",
                        );
                        await refresh();
                      })
                    }
                  >
                    Use for all notes
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || dirty}
                    onClick={() =>
                      void run(async () => {
                        if (
                          suggestion.current?.expectedVersion !== batch.version
                        )
                          suggestion.current = null;
                        suggestion.current ??= {
                          id: crypto.randomUUID(),
                          expectedVersion: batch.version,
                        };
                        await cache.api(
                          `/import-batches/${id}/suggest`,
                          suggestion.current,
                        );
                        suggestion.current = null;
                        await refresh();
                      })
                    }
                  >
                    Suggest organization
                  </Button>
                </div>
                <p className="import-small">
                  Suggestions use your AI settings and usage allowance. You can
                  always choose notebooks manually.
                </p>
              </section>
              <h3>
                {batch.total} proposed {batch.total === 1 ? "note" : "notes"}
              </h3>
              {batch.notes.map((note) => (
                <DraftReview
                  key={note.id}
                  note={note}
                  filename={
                    batch.files.find((f) => f.id === note.fileId)?.filename ??
                    "Imported note"
                  }
                  busy={busy}
                  save={edit}
                  onDirty={onDirty}
                />
              ))}
            </>
          )}
          {(batch.status === "complete" || batch.status === "cancelled") && (
            <section aria-label="Import results">
              <h3>
                {batch.status === "complete"
                  ? "Import complete"
                  : "Import cancelled"}
              </h3>
              <p>
                {batch.imported} notes imported.{" "}
                {batch.status === "cancelled"
                  ? "Already imported notes are kept."
                  : "Your original files remain private."}
              </p>
              <ul>
                {batch.notes
                  .filter((n) => n.memoryId)
                  .map((note) => (
                    <li key={note.id}>
                      <Link href={`/app/memories/${note.memoryId}`}>
                        {note.content
                          .split("\n")
                          .find((line) => line.trim())
                          ?.replace(/^#+\s*/, "")
                          .slice(0, 100) ?? "Imported note"}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          {!!history.length && (
            <Button
              variant="secondary"
              disabled={busy || dirty}
              onClick={() => {
                setAfter(history.at(-1));
                setHistory(history.slice(0, -1));
              }}
            >
              Previous notes
            </Button>
          )}
          {batch.next && (
            <Button
              variant="secondary"
              disabled={busy || dirty}
              onClick={() => {
                setHistory([...history, after]);
                setAfter(batch.next!);
              }}
            >
              Next notes
            </Button>
          )}
          {mutable && (
            <div className="import-confirm">
              <h3>
                {batch.selected} {batch.selected === 1 ? "note" : "notes"}{" "}
                selected · {batch.newNotebooks} new{" "}
                {batch.newNotebooks === 1 ? "notebook" : "notebooks"}
              </h3>
              <p>
                New notebooks are created only when you confirm. Notes placed in
                a publicly shared notebook follow its sharing settings
                immediately. Originals are retained privately; importing again
                can create duplicates.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                  disabled={busy}
                />
                I’ve reviewed the notes, destinations and sharing.
              </label>
              {dirty && (
                <p role="status">
                  Save or discard your note edits before continuing.
                </p>
              )}
              <Button
                disabled={busy || dirty || !reviewed || !batch.selected}
                onClick={() =>
                  void run(async () => {
                    if (confirm.current?.expectedVersion !== batch.version)
                      confirm.current = null;
                    confirm.current ??= {
                      id: crypto.randomUUID(),
                      expectedVersion: batch.version,
                    };
                    await cache.api(
                      `/import-batches/${id}/confirm`,
                      confirm.current,
                    );
                    await refresh();
                  })
                }
              >
                Confirm import
              </Button>
            </div>
          )}
          {!["complete", "cancelled"].includes(batch.status) && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  controller.current?.abort();
                  await cache.api(`/import-batches/${id}/cancel`, {});
                  await refresh();
                  upload.current = null;
                })
              }
            >
              Cancel import
            </Button>
          )}
        </>
      )}
      {busy && <p role="status">Working…</p>}
    </div>
  );
}
