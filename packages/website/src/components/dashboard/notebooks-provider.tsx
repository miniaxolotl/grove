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
import { api, errorMessage, type Project } from "@/lib/dashboard-api";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [location, setLocation] = useState<NotebookLocation>();
  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Project[]>("/projects", undefined, undefined, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setProjects(list);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  const saved = useCallback((project: Project) => {
    setProjects((previous) => [
      ...previous.filter((p) => p.id !== project.id),
      project,
    ]);
  }, []);
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
