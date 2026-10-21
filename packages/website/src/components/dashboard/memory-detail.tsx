"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  History,
  Trash2,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { dateLabel, isInactive, memoryTitle } from "@/lib/memory-display";
import { isActiveSurface, isTyping } from "@/lib/workspace-keyboard";
import { Markdown } from "./markdown";
import { MemoryEditor } from "./memory-editor";
import { Dialog, useDialogBusy } from "./dialog";
import { RevisionCompare } from "./revision-compare";
import { ActionMenu } from "./ui/action-menu";
import { useToast } from "./toasts";
import { useWorkspaceCommands } from "./workspace-commands";
import { NoteActions } from "./note-actions";

export function MemoryDetail({
  memory,
  projects,
  onSaved,
  onMove,
  onArchive,
  onPrevious,
  onNext,
  busy: actionBusy,
  fullPage = false,
  initialPreview = true,
  initialDelete = false,
  onDeleted,
  close,
}: {
  memory: Memory;
  projects: Project[];
  onSaved: (memory: Memory) => void;
  onMove: () => void;
  onArchive: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  busy: boolean;
  fullPage?: boolean;
  initialPreview?: boolean;
  initialDelete?: boolean;
  onDeleted: () => void;
  close: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const toast = useToast();
  const [compare, setCompare] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorLocked, setEditorLocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const [history, setHistory] = useState<
    { version: number; content: string; createdAt: string }[] | null
  >(null);
  const [related, setRelated] = useState<Record<string, string>>({});
  const operations = useRef(new Map<string, string>());
  const setDialogBusy = useDialogBusy();
  const locked = busy || actionBusy || editorLocked;
  useEffect(() => {
    if (!initialDelete) return;
    const frame = requestAnimationFrame(() => setConfirmDelete(true));
    return () => cancelAnimationFrame(frame);
  }, [initialDelete]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      (memory.enrichment?.relationships ?? []).map(async ({ id }) => {
        try {
          return [
            id,
            memoryTitle(
              await api<Memory>(
                `/memories/${id}`,
                undefined,
                undefined,
                controller.signal,
              ),
            ),
          ] as const;
        } catch {
          return [id, "Linked note"] as const;
        }
      }),
    ).then((entries) => {
      if (!controller.signal.aborted) setRelated(Object.fromEntries(entries));
    });
    return () => controller.abort();
  }, [memory]);
  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController();
    api<typeof history>(
      `/memories/${memory.id}/revisions`,
      undefined,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setHistory(value);
          setHistoryError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setHistoryError(errorMessage(error));
      });
    return () => controller.abort();
  }, [historyOpen, memory.id, memory.version]);
  async function run(action: () => Promise<void>) {
    if (locked) return;
    setBusy(true);
    setDialogBusy(true);
    try {
      await action();
    } catch (error) {
      toast(errorMessage(error), true);
    } finally {
      setBusy(false);
      setDialogBusy(false);
    }
  }
  async function mutate<T>(path: string, body: object) {
    const key = JSON.stringify({ path, body });
    if (!operations.current.has(key))
      operations.current.set(key, crypto.randomUUID());
    return api<T>(path, { ...body, operationId: operations.current.get(key) });
  }
  useWorkspaceCommands(
    [
      {
        id: "note-history",
        label: "Revision history",
        run: () => setHistoryOpen(true),
      },
      { id: "note-move", label: "Move note", disabled: locked, run: onMove },
      {
        id: "note-archive",
        label: isInactive(memory) ? "Restore note" : "Archive note",
        disabled: locked,
        run: onArchive,
      },
      {
        id: "note-delete",
        label: "Delete note…",
        disabled: busy || actionBusy,
        run: () => setConfirmDelete(true),
      },
    ],
    root,
  );
  const handleNavigation = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      isTyping(event.target) ||
      !isActiveSurface(root.current) ||
      document.querySelector(":popover-open")
    )
      return;
    if (fullPage && !root.current?.contains(event.target as Node)) return;
    if (window.getSelection()?.toString()) return;
    if (event.key === "ArrowLeft" && onPrevious) {
      event.preventDefault();
      onPrevious();
    }
    if (event.key === "ArrowRight" && onNext) {
      event.preventDefault();
      onNext();
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !busy &&
      !actionBusy
    ) {
      event.preventDefault();
      setConfirmDelete(true);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleNavigation(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  return (
    <article
      ref={root}
      className={`note-workspace${fullPage ? " note-workspace-page" : ""}`}
    >
      <MemoryEditor
        key={editorRevision}
        memory={memory}
        projects={projects}
        fullPage={fullPage}
        workspace
        initialPreview={initialPreview}
        draftKey={`note:${memory.id}`}
        cancel={close}
        done={onSaved}
        onLockChange={setEditorLocked}
        deleteRequested={confirmDelete}
        cancelDelete={() => setConfirmDelete(false)}
        onDeleted={onDeleted}
        toolbar={({ locked: writing, onExport, secondary }) => (
          <>
            {!fullPage && (
              <>
                <button
                  type="button"
                  className="app-icon note-secondary-control"
                  disabled={!onPrevious}
                  onClick={onPrevious}
                  aria-label="Previous note"
                  title="Previous note (←)"
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  type="button"
                  className="app-icon note-secondary-control"
                  disabled={!onNext}
                  onClick={onNext}
                  aria-label="Next note"
                  title="Next note (→)"
                >
                  <ArrowRight size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="app-icon note-secondary-control"
              aria-label="History"
              title="History"
              onClick={() => setHistoryOpen(true)}
            >
              <History size={16} />
            </button>
            <ActionMenu label="Note actions">
              <NoteActions
                inactive={isInactive(memory)}
                locked={writing || busy || actionBusy}
                busy={busy || actionBusy}
                onMove={onMove}
                onExport={onExport}
                onArchive={onArchive}
                onDelete={() => setConfirmDelete(true)}
                before={
                  !fullPage && (
                    <Link href={`/app/memories/${memory.id}`}>
                      <ArrowUpRight size={15} /> Open note page
                    </Link>
                  )
                }
                details={
                  <>
                    <button type="button" onClick={() => setHistoryOpen(true)}>
                      <History size={15} />
                      Revision history
                    </button>
                    {secondary}
                    {!fullPage && (
                      <>
                        <button
                          type="button"
                          className="note-mobile-menu-item"
                          disabled={!onPrevious}
                          onClick={onPrevious}
                        >
                          <ArrowLeft size={16} />
                          Previous note
                        </button>
                        <button
                          type="button"
                          className="note-mobile-menu-item"
                          disabled={!onNext}
                          onClick={onNext}
                        >
                          <ArrowRight size={16} />
                          Next note
                        </button>
                      </>
                    )}
                  </>
                }
              />
            </ActionMenu>
            <button
              type="button"
              className="app-icon note-delete-button"
              aria-label="Delete note…"
              title="Delete note…"
              data-focus-key="note-delete"
              disabled={busy || actionBusy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={17} />
            </button>
          </>
        )}
        details={
          <>
            {!!memory.enrichment?.tags.length && (
              <div className="reader-tags">
                {memory.enrichment.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
            <dl className="note-dates">
              <dt>Created</dt>
              <dd>{dateLabel(memory.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{dateLabel(memory.updatedAt)}</dd>
            </dl>
            <details className="agent-details">
              <summary>Agent details</summary>
              <dl>
                <dt>Saved from</dt>
                <dd>{memory.source.agent}</dd>
                <dt>Note reference</dt>
                <dd>{memory.id}</dd>
                {memory.taskId && (
                  <>
                    <dt>Task reference</dt>
                    <dd>{memory.taskId}</dd>
                  </>
                )}
                <dt>Organization</dt>
                <dd>{memory.enrichment?.status ?? "disabled"}</dd>
                {memory.source.verification && (
                  <>
                    <dt>Verification</dt>
                    <dd>{memory.source.verification}</dd>
                  </>
                )}
                {memory.expiresAt && (
                  <>
                    <dt>Leaves recall</dt>
                    <dd>{dateLabel(memory.expiresAt)}</dd>
                  </>
                )}
                {memory.purgeAt && (
                  <>
                    <dt>Removed permanently</dt>
                    <dd>{dateLabel(memory.purgeAt)}</dd>
                  </>
                )}
              </dl>
              {!isInactive(memory) && (
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  onClick={() =>
                    void run(async () => {
                      await api(`/memories/${memory.id}/reprocess`, {
                        expectedVersion: memory.version,
                      });
                      toast("Grove will organize this note again.");
                    })
                  }
                >
                  Retry processing
                </button>
              )}
            </details>
          </>
        }
      >
        <details className="linked-notes">
          <summary>
            Linked notes{" "}
            <span>{memory.enrichment?.relationships.length ?? 0}</span>
          </summary>
          {memory.enrichment?.relationships.length ? (
            <ul className="related-memories">
              {memory.enrichment.relationships.map((relation) => (
                <li key={relation.id}>
                  <Link href={`/app/memories/${relation.id}`}>
                    {related[relation.id] ?? "Related note"}
                  </Link>
                  <span>
                    {relation.relationship === "complementary"
                      ? "Related"
                      : relation.relationship === "conflicting"
                        ? "May conflict"
                        : "Possible duplicate"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Connections appear as Grove finds related ideas.</p>
          )}
        </details>
      </MemoryEditor>
      {historyOpen && (
        <Dialog
          title="Revision history"
          close={() => setHistoryOpen(false)}
          busy={busy}
        >
          {historyError && (
            <p role="alert" className="app-error">
              {historyError}
            </p>
          )}
          {!history && !historyError && <p role="status">Loading history…</p>}
          <ol className="revision-list">
            {history?.map((revision) => (
              <li key={revision.version}>
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>
                    Revision {revision.version}
                    {revision.version === memory.version ? " · Current" : ""}
                  </span>
                  <span>{dateLabel(revision.createdAt)}</span>
                </div>
                {compare === revision.version ? (
                  <RevisionCompare
                    before={revision.content}
                    after={memory.content}
                    beforeLabel={`Version ${revision.version}`}
                    afterLabel={`Current · version ${memory.version}`}
                  />
                ) : (
                  <Markdown>{revision.content}</Markdown>
                )}
                {revision.version !== memory.version && (
                  <div className="flex flex-wrap gap-4">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setCompare(
                          compare === revision.version
                            ? null
                            : revision.version,
                        )
                      }
                    >
                      {compare === revision.version
                        ? "Close comparison"
                        : "Compare with current"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={locked}
                      onClick={() =>
                        void run(async () => {
                          const saved = await mutate<Memory>(
                            `/memories/${memory.id}/restore`,
                            {
                              expectedVersion: memory.version,
                              revision: revision.version,
                            },
                          );
                          onSaved(saved);
                          setEditorRevision((value) => value + 1);
                          setHistoryOpen(false);
                          toast("Revision restored as a new version.");
                        })
                      }
                    >
                      Restore as a new revision
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Dialog>
      )}
    </article>
  );
}
