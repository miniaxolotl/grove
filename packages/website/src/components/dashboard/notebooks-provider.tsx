"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import {
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import type {
  OrganizeNotebook,
  NotebookOrganization,
} from "@lib/shared/notebook-organization";
import { WorkspaceNotice } from "./toasts";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceCache } from "./workspace-cache";

type NotebookLocation = { path: string; projectId: string | null | undefined };
type Notebooks = {
  projects: Project[];
  loading: boolean;
  error: string;
  reload: () => void;
  location: NotebookLocation | undefined;
  setLocation: Dispatch<SetStateAction<NotebookLocation | undefined>>;
  state?: string;
  refreshing: boolean;
  organizing: string | null | undefined;
  openOrganizer: (id?: string, moving?: boolean) => void;
  closeOrganizer: () => void;
  choosingDestination: boolean;
  setChoosingDestination: (value: boolean) => void;
  organizationLocked: boolean;
  organizationError: string;
  organizationBusy: boolean;
  layoutReview: number;
  reviewLayout: () => Promise<Project[]>;
  organize: (
    project: Project,
    placement: Placement,
  ) => Promise<NotebookOrganization | null>;
};
export type Placement = Pick<
  OrganizeNotebook,
  "parentId" | "beforeId" | "afterId"
>;
type PendingMove = { project: Project; input: OrganizeNotebook; undo: boolean };
const Context = createContext<Notebooks | null>(null);

export function NotebooksProvider({ children }: { children: ReactNode }) {
  const cache = useWorkspaceCache();
  const query = useQuery(cache.notebookCatalog());
  const projects = query.data?.items ?? [];
  const loading = query.isPending;
  const error = query.error ? errorMessage(query.error) : "";
  const [location, setLocation] = useState<NotebookLocation>();
  const [organizing, setOrganizing] = useState<string | null>();
  const [choosingDestination, setChoosingDestination] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  const [reviewRequired, setReviewRequired] = useState(false);
  const [layoutReview, setLayoutReview] = useState(0);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const pendingRef = useRef<PendingMove | null>(null);
  const [undo, setUndo] = useState<NotebookOrganization | null>(null);
  const [notice, setNotice] = useState("");
  const reload = useCallback(() => {
    void cache.client.invalidateQueries({
      queryKey: cache.notebookCatalog().queryKey,
    });
  }, [cache]);
  async function send(move: PendingMove): Promise<NotebookOrganization | null> {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setOrganizationError("");
    pendingRef.current = move;
    setPending(move);
    try {
      const result = await cache.api<NotebookOrganization>(
        `/projects/${move.project.id}/organize`,
        move.input,
      );
      pendingRef.current = null;
      setPending(null);
      setUndo(move.undo ? null : result);
      setNotice(
        move.undo ? "Notebook move undone." : `“${result.project.name}” moved.`,
      );
      setChoosingDestination(false);
      // Never adopt replayed rows/state: an accepted replay may already be old.
      try {
        await cache.client.fetchQuery(cache.notebookCatalog());
      } catch {
        setOrganizationError(
          "The move saved, but the notebook list could not refresh. Retry notebooks before moving again.",
        );
      }
      // A retry may complete after the original form's submit handler returned.
      // Replace any still-open form with the reconciled layout, not its old base.
      setLayoutReview((value) => value + 1);
      return result;
    } catch (error) {
      setOrganizationError(errorMessage(error));
      if (error instanceof DashboardApiError && error.status < 500) {
        pendingRef.current = null;
        setPending(null);
        setReviewRequired(true);
        reload();
      }
      // Unknown outcomes keep the exact operation and freeze further movement.
      return null;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function organize(project: Project, placement: Placement) {
    if (
      working.current ||
      pendingRef.current ||
      reviewRequired ||
      query.isError ||
      query.isFetching ||
      !query.data?.state
    )
      return null;
    setUndo(null);
    return send({
      project,
      input: {
        ...placement,
        operationId: crypto.randomUUID(),
        expectedVersion: project.version!,
        expectedState: query.data.state,
      },
      undo: false,
    });
  }
  async function reviewLayout() {
    if (working.current || pendingRef.current) return projects;
    await cache.client.invalidateQueries({
      queryKey: cache.notebookCatalog().queryKey,
    });
    const latest = await cache.client.fetchQuery(cache.notebookCatalog());
    setOrganizationError("");
    setReviewRequired(false);
    setUndo(null);
    setLayoutReview((value) => value + 1);
    return latest.items;
  }
  const organizationLocked =
    busy ||
    !!pending ||
    reviewRequired ||
    query.isError ||
    query.isFetching ||
    loading;
  return (
    <Context.Provider
      value={{
        projects,
        loading,
        error,
        reload,
        location,
        setLocation,
        state: query.data?.state,
        refreshing: query.isFetching,
        organizing,
        choosingDestination,
        setChoosingDestination,
        openOrganizer: (id, moving = false) => {
          setOrganizing(id ?? null);
          setChoosingDestination(moving);
        },
        closeOrganizer: () => {
          if (!busy) setOrganizing(undefined);
        },
        organizationLocked,
        organizationError,
        organizationBusy: busy,
        layoutReview,
        reviewLayout,
        organize,
      }}
    >
      {children}
      {(notice || organizationError || pending) && (
        <WorkspaceNotice>
          <div role={organizationError ? "alert" : "status"}>
            {busy ? "Moving notebook…" : organizationError || notice}
          </div>
          {pending && !busy && (
            <button onClick={() => void send(pending)}>Retry same move</button>
          )}
          {reviewRequired && (
            <button
              disabled={busy}
              onClick={() =>
                void reviewLayout().catch((e) =>
                  setOrganizationError(errorMessage(e)),
                )
              }
            >
              Review latest layout
            </button>
          )}
          {undo && !pending && !reviewRequired && (
            <button
              disabled={organizationLocked}
              onClick={() => {
                if (working.current || pendingRef.current) return;
                void send({
                  project: undo.project,
                  input: {
                    ...undo.undo,
                    expectedVersion: undo.project.version!,
                    expectedState: undo.state,
                    operationId: crypto.randomUUID(),
                  },
                  undo: true,
                });
              }}
            >
              Undo
            </button>
          )}
          {!pending && !reviewRequired && (
            <button
              onClick={() => {
                setNotice("");
                setOrganizationError("");
                setUndo(null);
              }}
            >
              Dismiss
            </button>
          )}
        </WorkspaceNotice>
      )}
    </Context.Provider>
  );
}

export function useNotebooks() {
  const context = useContext(Context);
  if (!context) throw new Error("Notebook components need NotebooksProvider");
  return context;
}

/** Keep navigation and creation aligned with a library filter or the open editor. */
export function useSetCurrentNotebook(
  projectId: string | null | undefined,
  active = true,
) {
  const { setLocation } = useNotebooks();
  const path = usePathname();
  useEffect(() => {
    if (!active) return;
    const location = { path, projectId };
    setLocation(location);
    return () =>
      setLocation((current) => (current === location ? undefined : current));
  }, [active, path, projectId, setLocation]);
}

export function useCurrentNotebook() {
  const { location } = useNotebooks();
  const path = usePathname();
  return location?.path === path
    ? location.projectId
    : path.startsWith("/app/projects/")
      ? path.split("/")[3]
      : undefined;
}
