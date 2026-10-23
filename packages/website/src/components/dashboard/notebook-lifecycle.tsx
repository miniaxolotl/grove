"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@/lib/dashboard-api";
import { DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import type {
  NotebookLifecycleAction,
  NotebookLifecyclePreview,
} from "@lib/shared/notebook-lifecycle";
import { Dialog, useDialogBusy } from "./dialog";
import { useWorkspaceCache } from "./workspace-cache";
import { useNoteDraftRevision, useNoteDrafts } from "./note-drafts";
import { Button } from "./ui/button";
import { LoadError } from "./load-error";

const verbs = { archive: "Archive", restore: "Restore", delete: "Delete" };
export function NotebookLifecycleDialog({
  project,
  action,
  close,
}: {
  project: Project;
  action: NotebookLifecycleAction;
  close: () => void;
}) {
  return (
    <Dialog title={`${verbs[action]} notebook`} close={close}>
      <NotebookLifecycleForm project={project} action={action} close={close} />
    </Dialog>
  );
}

function NotebookLifecycleForm({
  project,
  action,
  close,
}: {
  project: Project;
  action: NotebookLifecycleAction;
  close: () => void;
}) {
  const cache = useWorkspaceCache();
  const query = useQuery({
    ...cache.resource<NotebookLifecyclePreview>(
      `/projects/${project.id}/lifecycle`,
    ),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [reviewed, setReviewed] = useState<NotebookLifecyclePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const operationId = useRef(crypto.randomUUID());
  const setDialogBusy = useDialogBusy();
  const router = useRouter();
  const drafts = useNoteDrafts();
  useNoteDraftRevision();
  // Freeze what the user actually reviews. Background refresh never widens consent.
  if (!reviewed && !query.isFetching && query.data) setReviewed(query.data);
  const draftCount =
    reviewed && drafts
      ? [...drafts.values()].filter(
          (draft) =>
            reviewed.projectIds.includes(draft.projectId) ||
            (!!draft.base?.projectId &&
              reviewed.projectIds.includes(draft.base.projectId)),
        ).length
      : 0;
  async function review() {
    setBusy(true);
    try {
      const result = await query.refetch();
      if (result.error) throw result.error;
      setReviewed(result.data);
      setConflict(false);
      setError("");
      operationId.current = crypto.randomUUID();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="app-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          !reviewed ||
          busy ||
          conflict ||
          draftCount ||
          (action === "restore" && !reviewed.canRestore)
        )
          return;
        setBusy(true);
        setDialogBusy(true);
        setError("");
        try {
          await cache.api(`/projects/${project.id}/${action}`, {
            operationId: operationId.current,
            expectedVersion: reviewed.project.version,
            fingerprint: reviewed.fingerprint,
          });
          close();
          router.push(
            action === "archive"
              ? "/app/projects?status=archived"
              : "/app/projects",
          );
        } catch (e) {
          setError(errorMessage(e));
          if (
            e instanceof DashboardApiError &&
            ["version_conflict", "notebook_inactive"].includes(e.code)
          )
            setConflict(true);
        } finally {
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      <p>
        <strong>{reviewed?.project.name ?? project.name}</strong>
      </p>
      {reviewed ? (
        <>
          <p>
            {reviewed.notebooks}{" "}
            {reviewed.notebooks === 1 ? "notebook" : "notebooks"} and{" "}
            {reviewed.notes} {reviewed.notes === 1 ? "note" : "notes"},
            including all sub-notebooks.
          </p>
          <p>
            {action === "archive"
              ? "Hide these notebooks and archive their notes. Restore them from Archived notebooks. Notes already archived stay archived when restored."
              : action === "restore"
                ? "Restore the notebooks and notes archived together. Previously archived or expired notes stay inactive; original retention dates do not change."
                : "Hide these notebooks, their notes and history from Grove. This is a soft deletion: retained records are not permanently erased. There is no in-app Undo."}
          </p>
          <p>
            Direct links to these notebooks and notes will be turned off.
            Restoring does not turn them back on, but a shared parent notebook
            can include the restored contents again.
          </p>
          {!!draftCount && (
            <p role="alert" className="app-error">
              Finish saving or resolving drafts in these notebooks first (
              {draftCount}). Your local writing will not be discarded.
            </p>
          )}
          {action === "restore" && !reviewed.canRestore && (
            <p role="alert" className="app-error">
              Restore the parent notebook first.
            </p>
          )}
        </>
      ) : query.error ? (
        <LoadError
          message={errorMessage(query.error)}
          retry={() => void review()}
        />
      ) : (
        <p role="status">Checking affected contents…</p>
      )}
      {error && (
        <p role="alert" className="app-error">
          {error}
        </p>
      )}
      {conflict && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void review()}
        >
          Review current contents
        </Button>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          variant={action === "delete" ? "danger" : "primary"}
          disabled={
            !reviewed ||
            busy ||
            conflict ||
            !!draftCount ||
            (action === "restore" && !reviewed.canRestore)
          }
        >
          {busy
            ? "Working…"
            : `${verbs[action]} notebook${reviewed && reviewed.notebooks > 1 ? "s" : ""}`}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
