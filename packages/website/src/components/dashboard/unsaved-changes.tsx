"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const Context = createContext<Set<symbol> | null>(null);

/** One unload warning for the current authenticated session; nothing is persisted. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [owners] = useState(() => new Set<symbol>());
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!owners.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [owners]);
  return <Context.Provider value={owners}>{children}</Context.Provider>;
}

export function useUnsavedChanges(dirty: boolean) {
  const owners = useContext(Context);
  useEffect(() => {
    if (!dirty || !owners) return;
    const owner = Symbol();
    owners.add(owner);
    return () => {
      owners.delete(owner);
    };
  }, [owners, dirty]);
}
