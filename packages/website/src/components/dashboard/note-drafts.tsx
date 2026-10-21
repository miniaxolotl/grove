"use client";

import { createContext, useContext, useEffect, useState } from "react";
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
  latest?: Memory;
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

const Drafts = createContext<Map<string, NoteDraft> | null>(null);

// The authenticated shell owns this in-memory cache and remounts on account
// changes. Private drafts never enter URLs, localStorage or another account.
export function NoteDraftsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [drafts] = useState(() => new Map<string, NoteDraft>());
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
