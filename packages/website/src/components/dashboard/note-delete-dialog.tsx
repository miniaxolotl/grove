"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { memoryTitle } from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { useNoteDrafts, useNoteDraftRevision } from "./note-drafts";
import { useToast } from "./toasts";

export function NoteDeleteDialog({
  memories,
  close,
  onDeleted,
  onPendingChange,
  retrySave,
  conflict = false,
}: {
  memories: Memory[];
  close: () => void;
  onDeleted: (deleted: Memory[]) => void;
  onPendingChange?: (ids: string[], pending: boolean) => void;
  retrySave?: () => void;
  conflict?: boolean;
}) {
  const cache = useWorkspaceCache();
  const api = cache.api;
  const drafts = useNoteDrafts();
  useNoteDraftRevision();
  const single = memories.length === 1;
  const memory = memories[0];
  const key = `note:${memory.id}`;
  const [settled, setSettled] = useState<Memory>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const submitting = useRef(false);
  const operation = useRef<{ versions: string; id: string }>(undefined);
  const toast = useToast();
  // Hold every selected draft so nothing else settles them mid-delete.
  useLayoutEffect(() => {
    if (!drafts) return;
    for (const note of memories) drafts.hold(`note:${note.id}`);
  }, [drafts, memories]);
  const saving = single ? drafts?.get(key)?.saving : undefined;
  useEffect(() => {
    if (!single || !saving) return;
    let active = true;
    const expected = drafts?.get(key)?.pending?.input?.expectedVersion;
    void saving
      .then(
        (saved) => {
          if (active) {
            setSettled(saved);
            if (typeof expected === "number" && saved.version > expected + 1)
              setReviewRequired(true);
          }
        },
        () => {},
      )
      .finally(() => {
        // Existing save settlement owns draft reconciliation, including newer typing.
        if (active) drafts?.notify();
      });
    return () => {
      active = false;
    };
  }, [single, saving, drafts, key]);
  const entries = memories.map((note) => {
    const noteKey = `note:${note.id}`;
    const draft = drafts?.get(noteKey);
    return { note, key: noteKey, draft };
  });  const currentFor = (entry: (typeof entries)[number]) =>
    [entry.note, entry.draft?.base, single ? settled : undefined]
      .filter((note): note is Memory => !!note)
      .reduce(
        (latest, note) => (note.version > latest.version ? note : latest),
        entry.note,
      );
  const anySaving = single
    ? !!saving
    : entries.some((entry) => !!entry.draft?.saving);
  const uncertainCount = entries.filter(
    (entry) => !!entry.draft?.pending,
  ).length;
  const staleCount = entries.filter((entry) => !!entry.draft?.latest).length;
  const draftCount = entries.filter((entry) => !!entry.draft).length;
  const needsReview = conflict || reviewRequired || staleCount > 0;
  if (!memories.length) return null;
  async function retry() {
    if (retrySave) {
      retrySave();
      return;
    }
    const retained = drafts?.get(key);
    if (!retained?.pending?.input || retained.saving || submitting.current)
      return;
    setError("");
    const request = api<Memory>("/memories", {
      ...retained.pending.input,
      operationId: retained.pending.operationId,
    });
    drafts!.set(key, { ...retained, saving: request });
    try {
      const saved = await request;
      const latest = drafts!.get(key);
      const newer =
        saved.version > Number(retained.pending.input.expectedVersion) + 1;
      if (newer) setReviewRequired(true);
      if (latest?.saving === request)
        drafts!.set(key, {
          ...latest,
          base: newer ? latest.base : saved,
          latest: newer ? saved : latest.latest,
          saving: undefined,
          pending: null,
          error: newer
            ? "This note changed after your save. Review the newer version before saving again."
            : undefined,
        });
      setSettled(saved);
    } catch (reason) {
      const latest = drafts!.get(key);
      if (latest?.saving === request)
        drafts!.set(key, {
          ...latest,
          saving: undefined,
          error: errorMessage(reason),
        });
      setError(errorMessage(reason));
    }
  }
  async function remove() {
    if (
      anySaving ||
      uncertainCount > 0 ||
      needsReview ||
      submitting.current
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const versions = JSON.stringify(
      entries.map((entry) => [entry.note.id, currentFor(entry).version]),
    );
    if (operation.current?.versions !== versions)
      operation.current = { versions, id: crypto.randomUUID() };
    const ids = memories.map((note) => note.id);
    // Instant patch first: the rows leave immediately, then the request settles.
    onPendingChange?.(ids, true);
    cache.applyNoteRecords(new Map(memories.map((note) => [note.id, null])));
    onDeleted(memories);
    close();
    try {
      const result = await api<{ results: { id?: string; outcome: string }[] }>(
        "/memories/delete",
        {
          items: entries.map((entry) => ({
            id: entry.note.id,
            expectedVersion: currentFor(entry).version,
          })),
          operationId: operation.current.id,
        },
      );
      const failed = entries.filter(
        (_, index) =>
          !["deleted", "not_found"].includes(
            result.results[index]?.outcome ?? "",
          ),
      );
      if (failed.length) {
        // Only the failed notes snap back; the rest stay deleted.
        cache.restoreNoteRecords(
          new Map(failed.map((entry) => [entry.note.id, entry.note])),
        );
        const names = failed
          .slice(0, 3)
          .map((entry) => `“${memoryTitle(entry.note)}”`)
          .join(", ");
        toast(
          single
            ? "This note changed or is no longer available. It is back in your notes; open it to review before deleting."
            : `${failed.length} of ${memories.length} notes changed or are no longer available and are back in your notes (${names}${failed.length > 3 ? ", …" : ""}). Review them before deleting.`,
          true,
        );
      } else {
        for (const entry of entries) drafts?.delete(entry.key);
        toast(
          single ? "Note deleted." : `${memories.length} notes deleted.`,
        );
      }
    } catch (reason) {
      cache.restoreNoteRecords(
        new Map(memories.map((note) => [note.id, note])),
      );
      toast(errorMessage(reason), true);
    } finally {
      onPendingChange?.(ids, false);
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={single ? "Delete note?" : `Delete ${memories.length} notes?`}
      close={close}
      busy={busy}
    >
      {single ? (
        <p className="mb-4 text-sm">
          Delete “{memoryTitle(currentFor(entries[0]))}”? It and its history
          will be hidden from your Grove.
        </p>
      ) : (
        <p className="mb-4 text-sm">
          Delete {memories.length} notes? They and their history will be
          hidden from your Grove.
        </p>
      )}
      {!!draftCount && (
        <p className="mb-4 text-sm">
          {single
            ? "Your local draft will also be discarded. Cancel keeps your changes."
            : `Local drafts for these notes will also be discarded. Cancel keeps your changes.`}
        </p>
      )}
      {needsReview ? (
        <p className="app-error" role="alert">
          {single
            ? "This note changed elsewhere. Cancel and review the saved version before deleting."
            : "Some notes changed elsewhere. Cancel and review the saved versions before deleting."}
        </p>
      ) : anySaving ? (
        <p role="status">
          {single
            ? "Finishing the pending save before deletion…"
            : "Finishing the pending saves before deletion…"}
        </p>
      ) : (
        uncertainCount > 0 && (
          <div className="app-notice">
            <p>
              {single
                ? "The last save needs to be resolved before deleting this note. Your draft is still here."
                : `${uncertainCount} ${uncertainCount === 1 ? "note has" : "notes have"} unresolved saves. Save or discard them, then delete again. Your drafts are still here.`}
            </p>
            {single && (
              <button
                type="button"
                className="text-button"
                onClick={() => void retry()}
              >
                Retry pending save
              </button>
            )}
          </div>
        )
      )}
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className="app-button secondary"
          data-autofocus
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
        <button
          type="button"
          className="app-button danger"
          disabled={
            busy || anySaving || uncertainCount > 0 || needsReview
          }
          onClick={() => void remove()}
        >
          {busy
            ? "Deleting…"
            : single
              ? draftCount
                ? "Delete note and discard draft"
                : "Delete this note"
              : `Delete ${memories.length} notes`}
        </button>
      </div>
    </Dialog>
  );
}
