"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { Memory } from "@lib/shared/contracts";
import { deferredFeature } from "./deferred-feature";
const NoteExportDialog = deferredFeature(
  () => import("./note-export-dialog"),
  "Opening note export…",
);
type Snapshot = {
  content: string;
  unsaved: boolean;
  noteId?: string;
  version?: number;
};
export type Source =
  | { key: string; snapshot: Snapshot; note?: never }
  | { key: string; note: Memory; snapshot?: never };
type Request = { source: Source; path: string; noteId?: string };
const Context = createContext<{
  open: (source: Source) => void;
  followSave: (key: string, id: string) => void;
} | null>(null);
export function useNoteExport() {
  const value = useContext(Context);
  if (!value) throw new Error("Note export needs NoteExportProvider");
  return value;
}

/** Account-scoped so a first-save route transition can retain an open export. */
export function NoteExportProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [request, setRequest] = useState<Request>();
  const open = useCallback(
    (source: Source) => setRequest({ source, path }),
    [path],
  );
  const followSave = useCallback((key: string, id: string) => {
    setRequest((current) =>
      current?.source.key === key ? { ...current, noteId: id } : current,
    );
  }, []);
  const visible =
    request &&
    (request.path === path || path === `/app/memories/${request.noteId}`);
  useEffect(() => {
    if (request && !visible) {
      const frame = requestAnimationFrame(() => setRequest(undefined));
      return () => cancelAnimationFrame(frame);
    }
  }, [request, visible]);
  return (
    <Context.Provider value={{ open, followSave }}>
      {children}
      {visible && (
        <NoteExportDialog
          key={request.source.key}
          source={request.source}
          close={() => setRequest(undefined)}
        />
      )}
    </Context.Provider>
  );
}
