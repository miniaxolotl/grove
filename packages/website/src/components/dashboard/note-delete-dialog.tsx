"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceApi } from "./workspace-cache";
import { memoryTitle } from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { useNoteDrafts, useNoteDraftRevision } from "./note-drafts";
import { useToast } from "./toasts";

export function NoteDeleteDialog({
  memory,
  close,
  onDeleted,
  retrySave,
  conflict = false,
}: {
  memory: Memory;
  close: () => void;
  onDeleted: () => void;
  retrySave?: () => void;
  conflict?: boolean;
}) {
  const api = useWorkspaceApi();
  const drafts = useNoteDrafts();
  useNoteDraftRevision();
  const key = `note:${memory.id}`;
  const draft = drafts?.get(key);
  const [settled, setSettled] = useState<Memory>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const submitting = useRef(false);
  const operation = useRef<{ version: number; id: string }>(undefined);
  const toast = useToast();
  useLayoutEffect(() => drafts?.hold(key), [drafts, key]);
  const saving = draft?.saving;
  useEffect(() => {
    if (!saving) return;
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
  }, [saving, drafts, key]);
  const current = [memory, draft?.base, settled]
    .filter((note): note is Memory => !!note)
    .reduce(
      (latest, note) => (note.version > latest.version ? note : latest),
      memory,
    );
  const uncertain = !!draft?.pending;
  const needsReview = conflict || reviewRequired || !!draft?.latest;
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
    if (saving || uncertain || needsReview || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    if (operation.current?.version !== current.version)
      operation.current = { version: current.version, id: crypto.randomUUID() };
    try {
      const result = await api<{ results: { outcome: string }[] }>(
        "/memories/delete",
        {
          items: [{ id: memory.id, expectedVersion: current.version }],
          operationId: operation.current.id,
        },
      );
      if (result.results[0]?.outcome !== "deleted")
        throw new Error(
          "This note changed or is no longer available. Close this dialog and open the note to review it before deleting.",
        );
      drafts?.delete(key);
      onDeleted();
      toast("Note deleted.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog title="Delete note?" close={close} busy={busy}>
      <p className="mb-4 text-sm">
        Delete “{memoryTitle(current)}”? It and its history will be hidden from
        your Grove.
      </p>
      {!!draft && (
        <p className="mb-4 text-sm">
          Your local draft will also be discarded. Cancel keeps your changes.
        </p>
      )}
      {needsReview ? (
        <p className="app-error" role="alert">
          This note changed elsewhere. Cancel and review the saved version
          before deleting.
        </p>
      ) : saving ? (
        <p role="status">Finishing the pending save before deletion…</p>
      ) : (
        uncertain && (
          <div className="app-notice">
            <p>
              The last save needs to be resolved before deleting this note. Your
              draft is still here.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => void retry()}
            >
              Retry pending save
            </button>
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
          disabled={busy || !!saving || uncertain || needsReview}
          onClick={() => void remove()}
        >
          {busy
            ? "Deleting…"
            : draft
              ? "Delete note and discard draft"
              : "Delete this note"}
        </button>
      </div>
    </Dialog>
  );
}
