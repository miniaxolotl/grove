"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage } from "@/lib/dashboard-api";
import { useNotebooks } from "./notebooks-provider";
import { NotebookSelect } from "./notebook-select";
import {
  isInactive,
  memoryTitle,
  moveMemoryInput,
  noteKindLabel,
} from "@/lib/memory-display";
import { Dialog } from "./dialog";
import { MemoryDetail } from "./memory-detail";
import { LoadError } from "./load-error";
import { PageHeading } from "./ui/page-heading";
import { Button } from "./ui/button";

export function MemoryInspector({
  id,
  close,
  fullPage = false,
  citedVersion,
}: {
  id: string;
  close?: () => void;
  fullPage?: boolean;
  citedVersion?: number;
}) {
  const router = useRouter();
  const [memory, setMemory] = useState<Memory>();
  const { projects } = useNotebooks();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState("personal");
  const [notice, setNotice] = useState("");
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
      setNotice(
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
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
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
              leading={[{ value: "personal", label: "Personal" }]}
              disabled={busy}
            />
            <p className="text-sm text-muted">
              Connected agents with access to this notebook can read this note.
            </p>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
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
            key={`${id}:${current.version}`}
            fullPage={fullPage}
            memory={current}
            projects={projects}
            busy={busy}
            onSaved={(message) => {
              setNotice(message);
              setRefresh((value) => value + 1);
            }}
            onDeleted={() => {
              if (close) close();
              else router.push("/app");
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
    <div className="memory-document">
      <Link
        className="workspace-back"
        href={
          current?.projectId ? `/app/projects/${current.projectId}` : "/app"
        }
      >
        <ArrowLeft size={15} />
        {current?.projectId
          ? (projects.find((project) => project.id === current.projectId)
              ?.name ?? "Notebook")
          : "Notes"}
      </Link>
      <PageHeading
        title={current ? memoryTitle(current) : "Note"}
        description={
          current
            ? `${noteKindLabel(current.kind)}${isInactive(current) ? (current.status === "archived" ? " · Archived" : " · Expired") : ""}`
            : undefined
        }
      />
      {contents}
    </div>
  ) : (
    <Dialog title="Your note" panel busy={busy} close={close!}>
      {contents}
    </Dialog>
  );
}
