"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  History,
  Trash2,
  Share2,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { dateLabel, isInactive } from "@/lib/memory-display";
import { isActiveSurface, isTyping } from "@/lib/workspace-keyboard";
import { Markdown } from "./markdown";
import { MemoryEditor } from "./memory-editor";
import { Dialog, useDialogBusy } from "./dialog";
import { RevisionCompare } from "./revision-compare";
import { ActionMenu } from "./ui/action-menu";
import { useToast } from "./toasts";
import { useWorkspaceCommands } from "./workspace-commands";
import { workspaceCommand } from "@/lib/workspace-commands";
import { ShareDialog } from "./share-dialog";
import { ConnectionPanel } from "./connection-panel";
import { NoteActions } from "./note-actions";
import { AssistanceAction } from "./assistance-action";

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
  const cache = useWorkspaceCache();
  const api = cache.api;
  const root = useRef<HTMLElement>(null);
  const toast = useToast();
  const [compare, setCompare] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorLocked, setEditorLocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const historyQuery = useQuery({
    ...cache.resource<
      { version: number; content: string; createdAt: string }[]
    >(`/memories/${memory.id}/revisions`),
    enabled: historyOpen,
  });
  const history = historyQuery.data;
  const historyError = historyQuery.error
    ? errorMessage(historyQuery.error)
    : "";
  const [relatedOpen, setRelatedOpen] = useState(false);
  const operations = useRef(new Map<string, string>());
  const setDialogBusy = useDialogBusy();
  const locked = busy || actionBusy || editorLocked;
  useEffect(() => {
    if (!initialDelete) return;
    const frame = requestAnimationFrame(() => setConfirmDelete(true));
    return () => cancelAnimationFrame(frame);
  }, [initialDelete]);
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
      workspaceCommand("note-share", () => setSharing(true)),
      workspaceCommand("note-history", () => setHistoryOpen(true)),
      workspaceCommand("note-move", onMove, {
        disabled: locked,
        disabledReason: "Finish saving your changes first",
      }),
      workspaceCommand(
        isInactive(memory) ? "note-restore" : "note-archive",
        onArchive,
        {
          disabled: locked,
          disabledReason: "Finish saving your changes first",
        },
      ),
      workspaceCommand("note-delete", () => setConfirmDelete(true), {
        disabled: busy || actionBusy,
        disabledReason: "An update is in progress",
      }),
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
            <button
              type="button"
              className="app-icon note-secondary-control"
              aria-label="Share note"
              title="Share note"
              onClick={() => setSharing(true)}
            >
              <Share2 size={16} />
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
                sharing={
                  <button
                    type="button"
                    className="note-mobile-menu-item"
                    onClick={() => setSharing(true)}
                  >
                    <Share2 size={15} /> Share note
                  </button>
                }
                before={
                  !fullPage && (
                    <Link href={`/app/memories/${memory.id}`}>
                      <ArrowUpRight size={15} /> Open note page
                    </Link>
                  )
                }
                details={
                  <>
                    <AssistanceAction
                      disabled={writing || locked || isInactive(memory)}
                      input={{
                        kind: "actions",
                        sources: [{ id: memory.id, version: memory.version }],
                        projectId: memory.projectId,
                      }}
                    />
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
                    <dt>Hidden after</dt>
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
        <details
          className="linked-notes"
          onToggle={(event) => setRelatedOpen(event.currentTarget.open)}
        >
          <summary>Linked notes</summary>
          {relatedOpen && (
            <ConnectionPanel level="note" endpointId={memory.id} />
          )}
        </details>
      </MemoryEditor>
      {sharing && (
        <ShareDialog
          target={{ kind: "note", id: memory.id }}
          blocked={locked}
          close={() => setSharing(false)}
        />
      )}
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
                    media={{
                      noteId: memory.id,
                      beforeVersion: revision.version,
                      afterVersion: memory.version,
                    }}
                    before={revision.content}
                    after={memory.content}
                    beforeLabel={`Version ${revision.version}`}
                    afterLabel={`Current · version ${memory.version}`}
                  />
                ) : (
                  <Markdown
                    media={{ noteId: memory.id, version: revision.version }}
                  >
                    {revision.content}
                  </Markdown>
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
