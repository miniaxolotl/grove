"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceCache } from "@/lib/workspace-cache";
import { WorkspaceNavigationState } from "./workspace-navigation-state";

const Context = createContext<WorkspaceCache | null>(null);
export function WorkspaceCacheProvider({
  account,
  children,
}: {
  account: string;
  children: ReactNode;
}) {
  const [denied, setDenied] = useState(false);
  const [cache] = useState(
    () => new WorkspaceCache(undefined, () => setDenied(true)),
  );
  useEffect(() => {
    cache.start(account);
    return () => cache.dispose();
  }, [cache, account]);
  if (denied)
    return (
      <main id="main" className="app-opening">
        <p role="alert">Your session has ended.</p>
        <a href="/app">Sign in again</a>
      </main>
    );
  return (
    <Context.Provider value={cache}>
      <QueryClientProvider client={cache.client}>
        <WorkspaceNavigationState key={account} account={account}>
          {children}
        </WorkspaceNavigationState>
      </QueryClientProvider>
    </Context.Provider>
  );
}
export function useWorkspaceCache() {
  const cache = useContext(Context);
  if (!cache)
    throw new Error("Workspace queries need an authenticated cache provider");
  return cache;
}
export const useWorkspaceApi = () => useWorkspaceCache().api;
