"use client";
import { useEffect, useRef } from "react";
import type { Page } from "@lib/shared/contracts";
import type {
  NotebookVisit,
  NotebookVisitRequest,
} from "@lib/shared/assistance";
import { useWorkspaceCache } from "./workspace-cache";

/** Mounted visible lists acknowledge once; cache prefetch and background reads never do. */
export function useNotebookVisit(
  snapshot: Page<unknown>["visit"],
  onVisit?: (visit: NotebookVisit) => void,
) {
  const cache = useWorkspaceCache();
  const visits = useRef(
    new Map<string, { input: NotebookVisitRequest; result?: NotebookVisit }>(),
  );
  useEffect(() => {
    if (!snapshot?.ready || !onVisit) return;
    const controller = new AbortController();
    let running = false;
    const acknowledge = async () => {
      if (document.visibilityState !== "visible" || running) return;
      let saved = visits.current.get(snapshot.projectId);
      if (!saved) {
        saved = {
          input: {
            id: crypto.randomUUID(),
            projectId: snapshot.projectId,
            token: snapshot.token,
            from: snapshot.from,
          },
        };
        visits.current.set(snapshot.projectId, saved);
      }
      if (saved.result) {
        onVisit(saved.result);
        return;
      }
      running = true;
      try {
        const result = await cache.api<NotebookVisit>(
          "/notebook-visits",
          saved.input,
          "POST",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          saved.result = result;
          onVisit(result);
        }
      } catch {
        /* A failed acknowledgment retains its identity for the next visible load. */
      } finally {
        running = false;
      }
    };
    const frame = requestAnimationFrame(() => void acknowledge());
    const visible = () => void acknowledge();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [cache, snapshot, onVisit]);
}
