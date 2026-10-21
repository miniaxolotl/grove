"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { Memory } from "@lib/shared/contracts";

export type NoteValues = {
  content: string;
  kind: Memory["kind"];
  retention: string;
  autoKind: boolean;
  projectId: string;
};
export type NoteDraft = NoteValues & {
  base?: Memory;
  task: string;
  pending: {
    fingerprint: string;
    operationId: string;
    input?: Record<string, unknown>;
  } | null;
  saving?: Promise<Memory>;
  submitted?: NoteValues;
  error?: string;
};

class NoteDraftStore extends Map<string, NoteDraft> {
  private revision = 0;
  private listeners = new Set<() => void>();
  private holds = new Map<string, number>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  notify = () => {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  };
  override set(key: string, value: NoteDraft) {
    super.set(key, value);
    this.notify();
    return this;
  }
  override delete(key: string) {
    const removed = super.delete(key);
    if (removed) this.notify();
    return removed;
  }
  isHeld = (key: string) => this.holds.has(key);
  hold(key: string) {
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
    this.notify();
    return () => {
      const count = this.holds.get(key) ?? 0;
      if (count <= 1) this.holds.delete(key);
      else this.holds.set(key, count - 1);
      this.notify();
    };
  }
}
const Drafts = createContext<NoteDraftStore | null>(null);
const subscribeNone = () => () => {};
const zero = () => 0;
export function useNoteDraftRevision() {
  const drafts = useNoteDrafts();
  return useSyncExternalStore(
    drafts?.subscribe ?? subscribeNone,
    drafts?.snapshot ?? zero,
    zero,
  );
}
export function useDraftHeld(key: string) {
  const drafts = useNoteDrafts();
  return useSyncExternalStore(
    drafts?.subscribe ?? subscribeNone,
    () => drafts?.isHeld(key) ?? false,
    () => false,
  );
}

// The authenticated shell owns this in-memory cache and remounts on account
// changes. Private drafts never enter URLs, localStorage or another account.
export function NoteDraftsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [drafts] = useState(() => new NoteDraftStore());
  useEffect(() => {
    const protectDrafts = (event: BeforeUnloadEvent) => {
      if (!drafts.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDrafts);
    return () => window.removeEventListener("beforeunload", protectDrafts);
  }, [drafts]);
  return <Drafts.Provider value={drafts}>{children}</Drafts.Provider>;
}

export const useNoteDrafts = () => useContext(Drafts);
