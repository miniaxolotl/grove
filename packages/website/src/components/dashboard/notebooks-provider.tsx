"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceCache } from "./workspace-cache";
import { workspaceKeys } from "@/lib/workspace-cache";

type NotebookLocation = { path: string; projectId: string | null | undefined };
type Notebooks = {
  projects: Project[];
  loading: boolean;
  error: string;
  reload: () => void;
  saved: (project: Project) => void;
  location: NotebookLocation | undefined;
  setLocation: Dispatch<SetStateAction<NotebookLocation | undefined>>;
};
const Context = createContext<Notebooks | null>(null);

export function NotebooksProvider({ children }: { children: ReactNode }) {
  const cache = useWorkspaceCache();
  const query = useQuery(cache.resource<Project[]>("/projects"));
  const projects = query.data ?? [];
  const loading = query.isPending;
  const error = query.error ? errorMessage(query.error) : "";
  const [location, setLocation] = useState<NotebookLocation>();
  const reload = useCallback(() => {
    void cache.client.invalidateQueries({
      queryKey: workspaceKeys.resource("/projects"),
    });
  }, [cache]);
  const saved = useCallback(
    (project: Project) => {
      cache.client.setQueryData<Project[]>(
        workspaceKeys.resource("/projects"),
        (previous) => [
          ...(previous ?? []).filter((p) => p.id !== project.id),
          project,
        ],
      );
    },
    [cache],
  );
  return (
    <Context.Provider
      value={{ projects, loading, error, reload, saved, location, setLocation }}
    >
      {children}
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
