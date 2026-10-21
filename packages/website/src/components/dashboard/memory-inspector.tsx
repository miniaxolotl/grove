"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage } from "@/lib/dashboard-api";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import { isInactive, moveMemoryInput } from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { MemoryDetail } from "./memory-detail";
import { LoadError } from "./load-error";
import { Button } from "./ui/button";
import { useToast } from "./toasts";
import { useWorkspaceDrag } from "./memory-drag";

export function MemoryInspector({
  id,
  close,
  fullPage = false,
  citedVersion,
  initialPreview = true,
  journal = false,
}: {
  id: string;
  close?: () => void;
  fullPage?: boolean;
  citedVersion?: number;
  initialPreview?: boolean;
  journal?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const workspace = useWorkspaceDrag();
  const [memory, setMemory] = useState<Memory>();
  const { projects } = useNotebooks();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState("personal");
  const operations = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    api<Memory>(`/memories/${id}`, undefined, undefined, controller.signal)
      .then((record) => {
        if (!controller.signal.aborted) {
          setMemory(record);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [id, refresh]);
  const current = memory?.id === id ? memory : undefined;
  async function mutate(action: "move" | "archive" | "restore") {
    if (!current || busy) return;
    if (action === "move" && (current.projectId ?? "personal") === destination)
      return;
    const body =
      action === "move"
        ? moveMemoryInput(
            current,
            destination === "personal" ? null : destination,
          )
        : { expectedVersion: current.version };
    const path = action === "move" ? "/memories" : `/memories/${id}/${action}`;
    const key = JSON.stringify({ path, body });
    if (!operations.current.has(key))
      operations.current.set(key, crypto.randomUUID());
    setBusy(true);
    setError("");
    try {
      setMemory(
        await api<Memory>(path, {
          ...body,
          operationId: operations.current.get(key),
        }),
      );
      setMoving(false);
      workspace.refresh();
      toast(
        action === "move"
          ? "Note moved."
          : action === "archive"
            ? "Note archived."
            : "Note restored.",
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const contents = (
    <>
      {error && (
        <LoadError
          message={error}
          retry={() => setRefresh((value) => value + 1)}
        />
      )}
      {!current && !error && <p role="status">Opening your note…</p>}
      {current &&
        citedVersion !== undefined &&
        citedVersion !== current.version && (
          <p className="app-notice" role="status">
            This note has changed since the answer. You’re reading version{" "}
            {current.version}; the answer used version {citedVersion}. Open
            History to compare earlier versions.
          </p>
        )}
      {current &&
        (moving ? (
          <form
            className="app-form"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate("move");
            }}
          >
            <h2>Move note</h2>
            <NotebookSelect
              label="Destination"
              value={destination}
              onValueChange={setDestination}
              projects={projects}
              leading={[{ value: "personal", label: "Unfiled" }]}
              disabled={busy}
            />
            <p className="text-sm text-muted">
              Connected agents with access to this notebook can read this note.
            </p>
            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={
                  busy || (current.projectId ?? "personal") === destination
                }
              >
                Move here
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setMoving(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <MemoryDetail
            key={`${id}:${current.status}`}
            fullPage={fullPage}
            initialPreview={initialPreview}
            memory={current}
            projects={projects}
            busy={busy}
            onSaved={setMemory}
            close={
              close ??
              (() =>
                router.push(
                  current.projectId
                    ? `/app/projects/${current.projectId}`
                    : journal
                      ? "/app?sort=created_desc"
                      : "/app",
                ))
            }
            onDeleted={() => {
              workspace.refresh();
              if (close) close();
              else
                router.push(
                  current.projectId &&
                    projects.some((project) => project.id === current.projectId)
                    ? `/app/projects/${current.projectId}`
                    : isInactive(current)
                      ? "/app/archive"
                      : "/app",
                );
            }}
            onArchive={() =>
              void mutate(isInactive(current) ? "restore" : "archive")
            }
            onMove={() => {
              setDestination(current.projectId ?? "personal");
              setMoving(true);
            }}
          />
        ))}
    </>
  );
  return fullPage ? (
    <div className="note-document">{contents}</div>
  ) : (
    <Dialog title="Your note" panel busy={busy} close={close!}>
      {contents}
    </Dialog>
  );
}
