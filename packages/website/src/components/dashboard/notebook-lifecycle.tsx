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
import { useToast } from "./toasts";
import { Button } from "./ui/button";
import { LoadError } from "./load-error";
import { NotebookLifecycleSummary } from "./notebook-lifecycle-summary";

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
  const toast = useToast();
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
        // Instant patch first: the notebooks leave immediately, then the
        // request settles. Consent is the reviewed preview above.
        const staged = cache.stage({ scopes: reviewed.projectIds });
        cache.applyNotebookLifecycle(action, reviewed.projectIds);
        close();
        router.push(
          action === "archive"
            ? "/app/projects?status=archived"
            : "/app/projects",
        );
        try {
          await cache.api(`/projects/${project.id}/${action}`, {
            operationId: operationId.current,
            expectedVersion: reviewed.project.version,
            fingerprint: reviewed.fingerprint,
          });
          staged.commit();
        } catch (e) {
          // The notebooks snap back; the failure is reported persistently.
          staged.rollback();
          toast(errorMessage(e), true);
          if (
            e instanceof DashboardApiError &&
            ["version_conflict", "notebook_inactive"].includes(e.code)
          )
            setConflict(true);
          setBusy(false);
          setDialogBusy(false);
        }
      }}
    >
      <p className="wrap-anywhere">
        <strong>{reviewed?.project.name ?? project.name}</strong>
      </p>
      {reviewed ? (
        <>
          <NotebookLifecycleSummary
            action={action}
            notebooks={reviewed.notebooks}
            notes={reviewed.notes}
          />
          {!!draftCount && (
            <p role="alert" className="app-error my-0">
              Save or resolve {draftCount}{" "}
              {draftCount === 1 ? "draft" : "drafts"} first. Your writing is
              kept.
            </p>
          )}
          {action === "restore" && !reviewed.canRestore && (
            <p role="alert" className="app-error my-0">
              Restore the parent notebook first.
            </p>
          )}
        </>
      ) : query.error ? (
        <LoadError
          message={errorMessage(query.error)}
          title="Couldn’t check notebook contents"
          retry={() => void review()}
        />
      ) : (
        <p role="status">Checking notebook contents…</p>
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
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={busy}
          data-autofocus
          onClick={close}
        >
          Cancel
        </Button>
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
            ? "Checking contents…"
            : `${verbs[action]} notebook${reviewed && reviewed.notebooks > 1 ? "s" : ""}`}
        </Button>
      </div>
    </form>
  );
}
