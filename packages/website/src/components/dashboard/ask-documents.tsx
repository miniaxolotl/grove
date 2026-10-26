"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, FileText, X } from "lucide-react";
import type { DocumentList } from "@lib/shared/conversation-documents";
import { useWorkspaceCache } from "./workspace-cache";
import { errorMessage } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { ImportNotesPanel } from "./import-notes-button";
import "./ask-documents.css";

export function AskDocuments({
  conversationId,
  ensureChat,
  disabled,
  onState,
}: {
  conversationId?: string;
  ensureChat: () => Promise<string>;
  disabled: boolean;
  onState: (state: { busy: boolean; blocked: boolean; count: number }) => void;
}) {
  const cache = useWorkspaceCache(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState("");
  const chooser = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    running = useRef(false);
  const retry = useRef<{ id: string; file: File }[] | null>(null),
    conversion = useRef<{ id: string; expectedVersion: number } | null>(null);
  const [batch, setBatch] = useState<string>();
  const [uploadPending, setUploadPending] = useState(false);
  const query = useQuery({
    ...cache.resource<DocumentList>(
      `/conversations/${conversationId ?? "new"}/documents`,
    ),
    enabled: !!conversationId,
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data?.documents?.some((d) => d.status === "pending")
        ? 1200
        : false,
  });
  const list = query.data?.documents ?? [];
  const blocked =
    (!!conversationId && (!query.data || !!query.error)) ||
    uploadPending ||
    list.some((d) => d.status !== "ready");
  useEffect(() => {
    onState({ busy, blocked, count: list.length });
  }, [onState, busy, blocked, list.length]);
  useEffect(() => () => controller.current?.abort(), []);
  const previousChat = useRef(conversationId);
  useEffect(() => {
    if (previousChat.current && previousChat.current !== conversationId) {
      controller.current?.abort();
      retry.current = null;
      conversion.current = null;
      setUploadPending(false);
    }
    previousChat.current = conversationId;
  }, [conversationId]);
  async function upload(files?: File[]) {
    if (running.current || disabled) return;
    if (files) {
      if (
        files.length > 5 ||
        files.some(
          (f) =>
            !f.size ||
            f.size > 3 * 1024 * 1024 ||
            !/\.(pdf|docx|md|markdown|txt)$/i.test(f.name),
        )
      ) {
        setError(
          "Choose up to 5 PDF, DOCX, Markdown or text files, each 3 MiB or smaller.",
        );
        return;
      }
      retry.current = files.map((file) => ({ id: crypto.randomUUID(), file }));
      setUploadPending(true);
    }
    const pending = retry.current;
    if (!pending) return;
    running.current = true;
    setBusy(true);
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      const id = await ensureChat();
      for (const entry of pending) {
        setUploading(entry.file.name);
        const data = await entry.file.arrayBuffer();
        request.signal.throwIfAborted();
        const digest = await crypto.subtle.digest("SHA-256", data),
          hash = Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
        const response = await fetch(
          `/api/grove/conversations/${id}/documents/${entry.id}`,
          {
            method: "PUT",
            credentials: "same-origin",
            cache: "no-store",
            body: entry.file,
            signal: request.signal,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Grove-Filename": encodeURIComponent(entry.file.name),
              "X-Grove-Content-Sha256": hash,
              "X-Grove-Telemetry": "off",
            },
          },
        );
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(
            result.error?.message ?? "Upload failed. Retry or remove the file.",
          );
      }
      retry.current = null;
      setUploadPending(false);
      await cache.client.invalidateQueries({
        queryKey: [
          ...cache.resource(`/conversations/${id}/documents`).queryKey,
        ],
      });
    } catch (e) {
      if (!request.signal.aborted) setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
      setUploading("");
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await cache.api(
        `/conversations/${conversationId}/documents/${id}`,
        undefined,
        "DELETE",
      );
      await query.refetch();
      await cache.client.invalidateQueries({
        queryKey: cache.resource(`/conversations/${conversationId}`).queryKey,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function importText() {
    if (!conversationId || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const current = await cache.api<DocumentList>(
        `/conversations/${conversationId}/documents`,
      );
      await cache.api(`/conversations/${conversationId}/documents/accept`, {
        expectedVersion: current.version,
      });
      if (conversion.current?.expectedVersion !== current.version)
        conversion.current = {
          id: crypto.randomUUID(),
          expectedVersion: current.version,
        };
      const result = await cache.api<{ id: string }>(
        `/conversations/${conversationId}/documents/import`,
        conversion.current,
      );
      setBatch(result.id);
      await query.refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className="ask-documents"
      onDragOver={(e) => {
        if (!disabled) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled && !busy) void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="ask-document-actions">
        <Link
          className="text-button"
          href={
            conversationId
              ? `/app/settings/files?conversationId=${conversationId}`
              : "/app/settings/files"
          }
        >
          Files &amp; storage
        </Link>
        <button
          type="button"
          className="text-button"
          disabled={disabled || busy || uploadPending}
          onClick={() => chooser.current?.click()}
        >
          <Paperclip size={16} />
          Attach documents
        </button>
        {!!list.length && (
          <button
            type="button"
            className="text-button"
            disabled={disabled || busy || blocked}
            onClick={() => void importText()}
          >
            Save document text…
          </button>
        )}
      </div>
      <input
        className="sr-only"
        ref={chooser}
        type="file"
        multiple
        accept=".pdf,.docx,.md,.markdown,.txt"
        aria-label="Attach notes and documents"
        disabled={disabled || busy}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void upload(files);
        }}
      />
      {!!list.length && (
        <ul className="ask-document-list" aria-label="Attached documents">
          {list.map((doc) => (
            <li key={doc.id}>
              <FileText size={15} />
              <span>
                {doc.filename}
                <small>
                  {doc.status === "pending"
                    ? "Reading…"
                    : doc.status === "failed"
                      ? "Could not read this file. Remove it to continue."
                      : doc.pages && /\.pdf$/i.test(doc.filename)
                        ? `${doc.pages} page${doc.pages === 1 ? "" : "s"}`
                        : "Ready"}
                  {doc.emptyPages.length
                    ? ` · No text on pages ${doc.emptyPages.join(", ")}`
                    : ""}
                </small>
              </span>
              {doc.retryable && (
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled || busy}
                  onClick={async () => {
                    if (running.current) return;
                    running.current = true;
                    setBusy(true);
                    setError("");
                    try {
                      await cache.api(`/tasks/${doc.taskId}/retry`, {});
                      await query.refetch();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      running.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  Retry reading
                </button>
              )}
              <button
                type="button"
                className="app-icon"
                aria-label={`Remove ${doc.filename}`}
                disabled={disabled || busy}
                onClick={() => void remove(doc.id)}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(error || query.error) && (
        <p role="alert" className="app-error">
          {error || errorMessage(query.error)}{" "}
          <button
            className="text-button"
            type="button"
            onClick={() =>
              retry.current ? void upload() : void query.refetch()
            }
          >
            Retry
          </button>
          {uploadPending && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                retry.current = null;
                setUploadPending(false);
                setError("");
              }}
            >
              Discard unfinished upload
            </button>
          )}
        </p>
      )}
      {busy && (
        <p role="status">
          {uploading ? `Uploading ${uploading}…` : "Preparing documents…"}
        </p>
      )}
      {!!list.length && (
        <p className="ask-document-hint">
          Send or Save retains private originals; Remove revokes access.
          Passages go to your AI provider. No library notes are saved without
          confirmation.
        </p>
      )}
      {!!list.length && (
        <details className="ask-document-hint">
          <summary>Notes and privacy</summary>
          <p>
            Ask for a summary, study notes or a notebook to review generated
            notes. “Save document text” imports all extracted text instead.
            Unsent uploads expire after 24 hours. Accepted originals stay
            private and retained, including after removal or chat deletion.
          </p>
        </details>
      )}
      {batch && (
        <Dialog title="Save document text" close={() => setBatch(undefined)}>
          <ImportNotesPanel initialBatchId={batch} />
        </Dialog>
      )}
    </div>
  );
}
