"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Pencil,
  FolderInput,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { dateLabel, isInactive, memoryTitle } from "@/lib/memory-display";
import { Markdown } from "./markdown";
import { MemoryEditor } from "./memory-editor";
import { useDialogBusy } from "./dialog";

export function MemoryDetail({
  memory,
  projects,
  onSaved,
  onMove,
  onArchive,
  onPrevious,
  onNext,
  busy: actionBusy,
}: {
  memory: Memory;
  projects: Project[];
  onSaved: (message: string) => void;
  onMove: () => void;
  onArchive: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<
    { version: number; content: string; createdAt: string }[] | null
  >(null);
  const [related, setRelated] = useState<Record<string, string>>({});
  const operations = useRef(new Map<string, string>());
  const setDialogBusy = useDialogBusy();
  const locked = busy || actionBusy;
  const firstHeading = memory.content
    .trim()
    .match(/^#{1,6}\s+(.+)(?:\n|$)/)?.[1];
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      (memory.enrichment?.relationships ?? []).map(async ({ id }) => {
        try {
          return [
            id,
            memoryTitle(
              await api<Memory>(
                `/memories/${id}`,
                undefined,
                undefined,
                controller.signal,
              ),
            ),
          ] as const;
        } catch {
          return [id, "Related memory"] as const;
        }
      }),
    ).then((entries) => {
      if (!controller.signal.aborted) setRelated(Object.fromEntries(entries));
    });
    return () => controller.abort();
  }, [memory]);
  async function run(action: () => Promise<void>) {
    if (locked) return;
    setBusy(true);
    setDialogBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setDialogBusy(false);
    }
  }
  async function mutate(path: string, body: object) {
    const key = JSON.stringify({ path, body });
    if (!operations.current.has(key))
      operations.current.set(key, crypto.randomUUID());
    return api(path, { ...body, operationId: operations.current.get(key) });
  }
  if (editing)
    return (
      <MemoryEditor
        memory={memory}
        projects={projects}
        cancel={() => setEditing(false)}
        done={() =>
          onSaved("Memory saved. Context will update in the background.")
        }
      />
    );
  return (
    <article className="memory-reader">
      <div className="reader-navigation">
        <span>
          {memory.kind === "handoff" ? "Task handoff" : memory.kind} ·{" "}
          {projects.find((p) => p.id === memory.projectId)?.name ?? "Personal"}
        </span>
        <div>
          <button
            className="app-icon"
            disabled={!onPrevious || locked}
            onClick={onPrevious}
            aria-label="Previous memory"
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="app-icon"
            disabled={!onNext || locked}
            onClick={onNext}
            aria-label="Next memory"
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      {memory.enrichment?.title &&
        firstHeading?.toLocaleLowerCase() !==
          memory.enrichment.title.toLocaleLowerCase() && (
          <h3 className="reader-title">{memory.enrichment.title}</h3>
        )}
      <div className="reader-copy">
        <Markdown>{memory.content}</Markdown>
      </div>
      {!!memory.enrichment?.tags.length && (
        <div className="reader-tags">
          {memory.enrichment.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      <div className="reader-toolbar">
        <button
          className="app-button"
          disabled={locked}
          onClick={() => setEditing(true)}
        >
          <Pencil size={15} />
          Edit memory
        </button>
        <button
          className="app-button secondary"
          disabled={locked}
          onClick={onMove}
        >
          <FolderInput size={15} />
          Move
        </button>
        <button
          className="app-button secondary"
          disabled={locked}
          onClick={onArchive}
        >
          {isInactive(memory) ? (
            <ArchiveRestore size={15} />
          ) : (
            <Archive size={15} />
          )}
          {isInactive(memory) ? "Restore" : "Archive"}
        </button>
        <button
          className="app-button secondary"
          disabled={locked}
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(memory.content);
              setNotice("Markdown copied.");
            })
          }
        >
          <Copy size={15} />
          Copy
        </button>
      </div>
      {error && (
        <p role="alert" className="app-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {!!memory.enrichment?.relationships.length && (
        <section className="reader-section">
          <h3>Related memories</h3>
          <ul className="related-memories">
            {memory.enrichment.relationships.map((relation) => (
              <li key={relation.id}>
                <Link href={`/app/memories/${relation.id}`}>
                  {related[relation.id] ?? "Related memory"}
                </Link>
                <span>
                  {relation.relationship === "complementary"
                    ? "Related"
                    : relation.relationship === "conflicting"
                      ? "May conflict"
                      : "Possible duplicate"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="reader-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3>History</h3>
          <button
            className="text-button"
            disabled={locked}
            onClick={() =>
              run(async () =>
                setHistory(await api(`/memories/${memory.id}/revisions`)),
              )
            }
          >
            Revision history
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Updated {dateLabel(memory.updatedAt)} · revision {memory.version} ·
          saved from {memory.source.agent}
        </p>
        {history && (
          <ol className="revision-list">
            {history.map((revision) => (
              <li key={revision.version}>
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>
                    Revision {revision.version}
                    {revision.version === memory.version ? " · Current" : ""}
                  </span>
                  <span>{dateLabel(revision.createdAt)}</span>
                </div>
                <Markdown>{revision.content}</Markdown>
                {revision.version !== memory.version && (
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={() =>
                      run(async () => {
                        await mutate(`/memories/${memory.id}/restore`, {
                          expectedVersion: memory.version,
                          revision: revision.version,
                        });
                        onSaved("Revision restored as a new version.");
                      })
                    }
                  >
                    Restore as a new revision
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <details className="agent-details">
        <summary>Agent details</summary>
        <dl>
          <dt>Memory reference</dt>
          <dd>{memory.id}</dd>
          {memory.taskId && (
            <>
              <dt>Task reference</dt>
              <dd>{memory.taskId}</dd>
            </>
          )}
          <dt>Search index</dt>
          <dd>{memory.indexing}</dd>
          <dt>Organization</dt>
          <dd>{memory.enrichment?.status ?? "disabled"}</dd>
          {memory.source.verification && (
            <>
              <dt>Verification</dt>
              <dd>{memory.source.verification}</dd>
            </>
          )}
          {memory.expiresAt && (
            <>
              <dt>Leaves recall</dt>
              <dd>{dateLabel(memory.expiresAt)}</dd>
            </>
          )}
          {memory.purgeAt && (
            <>
              <dt>Removed permanently</dt>
              <dd>{dateLabel(memory.purgeAt)}</dd>
            </>
          )}
        </dl>
        <p>
          References let agents return to the same memory or handoff. You can
          use the title and project to find it here.
        </p>
        {!isInactive(memory) && (
          <button
            className="text-button"
            disabled={locked}
            onClick={() =>
              run(async () => {
                await api(`/memories/${memory.id}/reprocess`, {
                  expectedVersion: memory.version,
                });
                onSaved("Memory queued for processing.");
              })
            }
          >
            Retry processing
          </button>
        )}
      </details>
      <details className="agent-details">
        <summary>Delete memory</summary>
        <p>Permanently removes this memory and its revisions.</p>
        {!confirmDelete ? (
          <button
            className="app-button danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete permanently
          </button>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button
              className="app-button danger"
              disabled={locked}
              onClick={() =>
                run(async () => {
                  const result = (await mutate("/memories/delete", {
                    items: [{ id: memory.id, expectedVersion: memory.version }],
                  })) as { results: { outcome: string }[] };
                  if (result.results[0]?.outcome !== "deleted")
                    throw new Error("Memory changed; reload before deleting.");
                  onSaved("Memory permanently deleted.");
                })
              }
            >
              Delete this memory
            </button>
            <button
              className="app-button secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </details>
    </article>
  );
}
