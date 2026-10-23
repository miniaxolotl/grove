"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { Copy, Download, FileText } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceApi } from "./workspace-cache";
import {
  downloadNote,
  noteExportFilename,
  noteExportTitle,
} from "@/lib/note-export";
import { useNoteDrafts } from "./note-drafts";
import { Dialog } from "./dialog";
import { useToast } from "./toasts";

type Snapshot = {
  content: string;
  unsaved: boolean;
  noteId?: string;
  version?: number;
};
type Source =
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

function NoteExportDialog({
  source,
  close,
}: {
  source: Source;
  close: () => void;
}) {
  const api = useWorkspaceApi();
  const drafts = useNoteDrafts();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(source.snapshot);
  const [error, setError] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<{
    blob: Blob;
    filename: string;
    substituted: boolean;
  }>();
  const work = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      work.current?.abort();
    };
  }, []);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!source.note) return;
    const controller = new AbortController();
    const retained = drafts?.get(source.key);
    if (retained) {
      // Resolve before Copy is enabled, preserving clipboard user activation.
      queueMicrotask(() => {
        if (!controller.signal.aborted)
          setSnapshot({
            content: retained.content,
            unsaved: true,
            noteId: retained.base?.id,
            version: retained.base?.version,
          });
      });
    } else {
      void api<Memory>(
        `/memories/${source.note.id}`,
        undefined,
        undefined,
        controller.signal,
      )
        .then((memory) => {
          if (!controller.signal.aborted) {
            const draft = drafts?.get(source.key);
            setSnapshot({
              content: draft?.content ?? memory.content,
              unsaved: !!draft,
              noteId: memory.id,
              version: memory.version,
            });
            setError("");
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(errorMessage(reason));
        });
    }
    return () => controller.abort();
  }, [source, drafts, revision, api]);
  async function copy() {
    if (!snapshot) return;
    setError("");
    try {
      await navigator.clipboard.writeText(snapshot.content);
      if (active.current) {
        toast("Markdown copied.");
        close();
      }
    } catch {
      if (active.current) {
        setCopyFallback(true);
        setError(
          "Clipboard access is unavailable. Try again, or select and copy the text below.",
        );
      }
    }
  }
  async function pdf() {
    if (!snapshot || work.current) return;
    const controller = new AbortController();
    work.current = controller;
    setPreparing(true);
    setError("");
    try {
      const { createNotePdf } = await import("@/lib/note-pdf");
      controller.signal.throwIfAborted();
      const result = await createNotePdf(
        snapshot.content,
        controller.signal,
        snapshot.noteId
          ? { id: snapshot.noteId, version: snapshot.version! }
          : undefined,
      );
      if (!active.current || controller.signal.aborted) return;
      const filename = noteExportFilename(snapshot.content, "pdf");
      setPrepared({ ...result, filename });
      downloadNote(result.blob, filename);
      toast("PDF prepared. If the download did not start, use Download PDF.");
    } catch {
      if (active.current && !controller.signal.aborted)
        setError("Could not prepare the PDF. Try again, or export Markdown.");
    } finally {
      if (work.current === controller) work.current = null;
      if (active.current) setPreparing(false);
    }
  }
  return (
    <Dialog title="Export note" close={close}>
      <div data-private>
        {snapshot ? (
          <>
            <p className="line-clamp-3 break-words text-sm font-medium">
              {noteExportTitle(snapshot.content)}
            </p>
            {snapshot.unsaved && (
              <p className="mt-2 text-sm text-muted">
                Includes unsaved changes.
              </p>
            )}
            {!snapshot.content.trim() && (
              <p role="status">Add some text to export this note.</p>
            )}
            <div className="export-options">
              {snapshot.noteId && snapshot.content.includes("grove-media:") && (
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={snapshot.unsaved || preparing}
                  onClick={async () => {
                    if (!snapshot.noteId || work.current) return;
                    const controller = new AbortController();
                    work.current = controller;
                    setPreparing(true);
                    setError("");
                    try {
                      const response = await fetch(
                        `/api/grove/memories/${snapshot.noteId}/archive-file?version=${snapshot.version}`,
                        { cache: "no-store", signal: controller.signal },
                      );
                      if (!response.ok)
                        throw new Error(
                          "Archive unavailable. Refresh the note and try again.",
                        );
                      const blob = await response.blob();
                      controller.signal.throwIfAborted();
                      downloadNote(blob, `grove-note-${snapshot.noteId}.tar`);
                    } catch (error) {
                      if (!controller.signal.aborted && active.current)
                        setError(errorMessage(error));
                    } finally {
                      work.current = null;
                      if (active.current) setPreparing(false);
                    }
                  }}
                >
                  <Download size={17} />
                  Note with images (.tar)
                </button>
              )}
              <button
                type="button"
                className="app-button secondary"
                disabled={!snapshot.content.trim()}
                onClick={() => {
                  downloadNote(
                    new Blob([snapshot.content], {
                      type: "text/markdown;charset=utf-8",
                    }),
                    noteExportFilename(snapshot.content, "md"),
                  );
                  toast("Markdown download started.");
                }}
              >
                <Download size={17} />
                Markdown (.md)
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={
                  !snapshot.content.trim() ||
                  snapshot.content.length > 100_000 ||
                  preparing
                }
                onClick={() => void pdf()}
              >
                <FileText size={17} />
                {preparing ? "Preparing PDF…" : "PDF (.pdf)"}
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={!snapshot.content.trim()}
                onClick={() => void copy()}
              >
                <Copy size={17} />
                Copy Markdown
              </button>
            </div>
            {snapshot.content.includes("grove-media:") && (
              <p className="text-sm text-muted">
                Markdown keeps internal attachment references. Save changes and
                choose Note with images for portable original files, or PDF for
                embedded images. Original image metadata is retained.
              </p>
            )}
            {snapshot.content.length > 100_000 && (
              <p className="text-sm text-muted">
                PDF supports up to 100,000 characters. Markdown and Copy keep
                the complete draft.
              </p>
            )}
          </>
        ) : (
          !error && <p role="status">Opening the latest note…</p>
        )}
        {preparing && (
          <p role="status">
            Preparing your document. You can cancel at any time.
          </p>
        )}
        {prepared && (
          <div className="app-notice">
            <button
              type="button"
              className="text-button"
              onClick={() => downloadNote(prepared.blob, prepared.filename)}
            >
              Download PDF
            </button>
            {prepared.substituted && (
              <p>
                Characters unavailable in the PDF font are written as Unicode
                codes. Markdown preserves the original characters.
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="app-error" role="alert">
            {error}
          </p>
        )}
        {!snapshot && error && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Retry
          </button>
        )}
        {copyFallback && snapshot && (
          <label className="app-form">
            Markdown source
            <textarea
              readOnly
              className="export-source"
              value={snapshot.content}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )}
        <button
          type="button"
          className="app-button secondary mt-4"
          onClick={close}
        >
          {preparing ? "Cancel export" : "Done"}
        </button>
      </div>
    </Dialog>
  );
}
