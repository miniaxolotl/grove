"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import type { NotebookLifecyclePreview } from "@lib/shared/notebook-lifecycle";
import { Dialog } from "./dialog";
import { useWorkspaceCache } from "./workspace-cache";
import { useNoteDraftRevision, useNoteDrafts } from "./note-drafts";
import { useToast } from "./toasts";
import { Button } from "./ui/button";
import { LoadError } from "./load-error";
import {
  NotebookLifecycleSummary,
  notebookDraftWarning,
} from "./notebook-lifecycle-summary";

const verbs = { restore: "Restore", delete: "Delete" } as const;

/**
 * Bulk lifecycle for notebooks selected on the archived list. Previews load
 * in parallel, descendants covered by another selected root are deduped, and
 * each root commits sequentially with its own optimistic stage so one failure
 * rolls back only that root.
 */
export function NotebookBulkLifecycleDialog({
  projects,
  action,
  close,
  onDone,
}: {
  projects: Project[];
  action: "restore" | "delete";
  close: () => void;
  onDone: (summary: string) => void;
}) {
  const cache = useWorkspaceCache();
  const toast = useToast();
  const drafts = useNoteDrafts();
  useNoteDraftRevision();
  const [previews, setPreviews] = useState<Map<
    string,
    NotebookLifecyclePreview
  > | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const submitting = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const idsKey = projects.map((project) => project.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      projects.map(async (project) => {
        const preview = await cache.fetch<NotebookLifecyclePreview>(
          `/projects/${project.id}/lifecycle`,
          undefined,
          controller.signal,
        );
        return [project.id, preview] as const;
      }),
    )
      .then((results) => {
        if (!controller.signal.aborted) {
          setPreviews(new Map(results));
          setLoadError("");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(reason));
      });
    return () => {
      controller.abort();
    };
    // idsKey stands in for the fixed selection this dialog opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, idsKey, loadAttempt]);
  const roots = useMemo(() => {
    if (!previews) return [];
    return projects
      .filter(
        (project) =>
          previews.has(project.id) &&
          !projects.some(
            (other) =>
              other.id !== project.id &&
              previews.get(other.id)?.projectIds.includes(project.id),
          ),
      )
      .map((project) => ({ project, preview: previews.get(project.id)! }));
  }, [projects, previews]);
  const covered = useMemo(
    () => [...new Set(roots.flatMap((root) => root.preview.projectIds))],
    [roots],
  );
  const draftCount =
    drafts && covered.length
      ? [...drafts.values()].filter(
          (draft) =>
            covered.includes(draft.projectId) ||
            (!!draft.base?.projectId && covered.includes(draft.base.projectId)),
        ).length
      : 0;
  const blocked =
    action === "restore"
      ? roots.filter((root) => !root.preview.canRestore)
      : [];
  const actionable = roots.filter(
    (root) => action !== "restore" || root.preview.canRestore,
  );
  const notebooks = actionable.reduce(
    (total, root) => total + root.preview.notebooks,
    0,
  );
  const notes = actionable.reduce(
    (total, root) => total + root.preview.notes,
    0,
  );
  async function confirm() {
    if (!actionable.length || submitting.current || draftCount) return;
    submitting.current = true;
    const verb = action === "restore" ? "restored" : "deleted";
    const noun = (count: number) =>
      `${count} notebook${count === 1 ? "" : "s"}`;
    close();
    let succeeded = 0;
    const failed: string[] = [];
    let failedNotebooks = 0;
    for (const root of actionable) {
      // Each root leaves instantly on its own stage; a failure snaps back
      // only that root while the others keep their new state.
      const staged = cache.stage({ scopes: root.preview.projectIds });
      cache.applyNotebookLifecycle(action, root.preview.projectIds);
      try {
        await cache.api(`/projects/${root.project.id}/${action}`, {
          operationId: crypto.randomUUID(),
          expectedVersion: root.preview.project.version,
          fingerprint: root.preview.fingerprint,
        });
        staged.commit();
        succeeded += root.preview.notebooks;
      } catch (reason) {
        staged.rollback();
        failedNotebooks += root.preview.notebooks;
        failed.push(`${root.project.name}: ${errorMessage(reason)}`);
      }
    }
    const parts: string[] = [];
    if (succeeded) parts.push(`${noun(succeeded)} ${verb}.`);
    if (failed.length)
      parts.push(
        `${noun(failedNotebooks)} could not be ${verb}. ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "; …" : ""}`,
      );
    if (blocked.length) {
      const blockedNotebooks = blocked.reduce(
        (total, root) => total + root.preview.notebooks,
        0,
      );
      parts.push(
        `${noun(blockedNotebooks)} ${blockedNotebooks === 1 ? "needs" : "need"} the parent notebook restored first (${blocked
          .slice(0, 3)
          .map((root) => root.project.name)
          .join(", ")}${blocked.length > 3 ? ", …" : ""}).`,
      );
    }
    onDone(parts.join(" "));
    if (failed.length) toast(parts.join(" "), true);
  }
  return (
    <Dialog
      title={`${verbs[action]} ${projects.length === 1 ? "notebook" : "notebooks"}`}
      close={close}
    >
      <div className="app-form">
        {!previews && !loadError ? (
          <p role="status">Checking contents…</p>
        ) : loadError ? (
          <LoadError
            title="Couldn’t check notebook contents"
            message={loadError}
            retry={() => {
              cancel.current?.focus();
              setPreviews(null);
              setLoadError("");
              setLoadAttempt((attempt) => attempt + 1);
            }}
          />
        ) : (
          <>
            {!!actionable.length && (
              <>
                <p className="wrap-anywhere">
                  <strong>
                    {actionable.map((root) => root.project.name).join(", ")}
                  </strong>
                </p>
                <NotebookLifecycleSummary
                  action={action}
                  notebooks={notebooks}
                  notes={notes}
                />
              </>
            )}
            {!!blocked.length && action === "restore" && (
              <p role="alert" className="app-error my-0 wrap-anywhere">
                Restore the parent notebook first for:{" "}
                {blocked.map((root) => root.project.name).join(", ")}.
              </p>
            )}
            {!!draftCount && (
              <p role="alert" className="app-error my-0">
                {notebookDraftWarning(action, draftCount)}
              </p>
            )}
          </>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            ref={cancel}
            data-autofocus
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            variant={action === "delete" ? "danger" : "primary"}
            disabled={!actionable.length || !!draftCount}
            onClick={() => void confirm()}
          >
            {`${verbs[action]} ${projects.length > 1 ? "notebooks" : "notebook"}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
