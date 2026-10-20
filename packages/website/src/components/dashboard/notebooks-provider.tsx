"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";

type Notebooks = {
  projects: Project[];
  loading: boolean;
  error: string;
  reload: () => void;
  saved: (project: Project) => void;
};
const Context = createContext<Notebooks | null>(null);

export function NotebooksProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
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
    <Context.Provider value={{ projects, loading, error, reload, saved }}>
      {children}
    </Context.Provider>
  );
}

export function useNotebooks() {
  const context = useContext(Context);
  if (!context) throw new Error("Notebook components need NotebooksProvider");
  return context;
}
