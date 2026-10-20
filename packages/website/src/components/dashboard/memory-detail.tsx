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
  ArrowUpRight,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { dateLabel, isInactive, memoryTitle } from "@/lib/memory-display";
import { Markdown } from "./markdown";
import { MemoryEditor } from "./memory-editor";
import { useDialogBusy } from "./dialog";
import { SegmentedControl } from "./ui/segmented-control";
import { RevisionCompare } from "./revision-compare";

export function MemoryDetail({
  memory,
  projects,
  onSaved,
  onMove,
  onArchive,
  onPrevious,
  onNext,
  busy: actionBusy,
  fullPage = false,
  onDeleted,
}: {
  memory: Memory;
  projects: Project[];
  onSaved: (message: string) => void;
  onMove: () => void;
  onArchive: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  busy: boolean;
  fullPage?: boolean;
  onDeleted?: () => void;
}) {
  const [tab, setTab] = useState<"content" | "connections" | "history">(
    "content",
  );
  const [compare, setCompare] = useState<number | null>(null);
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
    .match(/^#{1,6}\s+(.+)(?:\n|$)/)?.[1]
    .trim();
  const readableContent =
    fullPage && firstHeading === memoryTitle(memory)
      ? memory.content
          .trimStart()
          .replace(/^#{1,6}[ \t]+[^\r\n]*(?:\r?\n|$)/, "")
          .trimStart()
      : memory.content;
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
          return [id, "Linked note"] as const;
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
          onSaved(
            "Note saved. Grove is updating its connections and summaries.",
          )
        }
      />
    );
  return (
    <article className={`memory-reader${fullPage ? " full-page-reader" : ""}`}>
      <div className="reader-main">
        {fullPage && (
          <SegmentedControl
            label="Note sections"
            value={tab}
            onChange={(value) => {
              setTab(value);
              if (value === "history" && !history)
                void run(async () =>
                  setHistory(await api(`/memories/${memory.id}/revisions`)),
                );
            }}
            options={[
              { value: "content", label: "Page" },
              {
                value: "connections",
                label: `Linked notes (${memory.enrichment?.relationships.length ?? 0})`,
              },
              { value: "history", label: "History" },
            ]}
          />
        )}
        <div className="reader-navigation">
          <span>
            {memory.kind === "handoff"
              ? "Progress note"
              : memory.kind === "fact"
                ? "Note"
                : memory.kind}{" "}
            ·{" "}
            {projects.find((p) => p.id === memory.projectId)?.name ??
              "Personal"}
          </span>
          {!fullPage && (
            <div>
              <Link
                className="app-icon"
                aria-label="Open note page"
                title="Open full page"
                href={`/app/memories/${memory.id}`}
              >
                <ArrowUpRight size={17} />
              </Link>
              <button
                className="app-icon"
                disabled={!onPrevious || locked}
                onClick={onPrevious}
                aria-label="Previous note"
              >
                <ArrowLeft size={17} />
              </button>
              <button
                className="app-icon"
                disabled={!onNext || locked}
                onClick={onNext}
                aria-label="Next note"
              >
                <ArrowRight size={17} />
              </button>
            </div>
          )}
        </div>
        {(!fullPage || tab === "content") && (
          <>
            {!fullPage && !firstHeading && memory.enrichment?.title && (
              <h3 className="reader-title">{memory.enrichment.title}</h3>
            )}
            <div className="reader-copy">
              <Markdown>{readableContent}</Markdown>
            </div>
            <p className="reader-lifetime">
              {memory.expiresAt
                ? `Kept until ${dateLabel(memory.expiresAt)}${memory.purgeAt ? ` · can be restored until ${dateLabel(memory.purgeAt)}` : ""}`
                : "Kept until you remove it"}
            </p>
            {!!memory.enrichment?.tags.length && (
              <div className="reader-tags">
                {memory.enrichment.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
          </>
        )}
        <div className="reader-toolbar">
          {fullPage ? (
            <Link
              className="app-button"
              href={`/app/memories/${memory.id}/edit`}
            >
              <Pencil size={15} /> Edit note
            </Link>
          ) : (
            <button
              className="app-button"
              disabled={locked}
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} />
              Edit note
            </button>
          )}
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
        {(!fullPage || tab === "connections") &&
          !!memory.enrichment?.relationships.length && (
            <section className="reader-section">
              <h3>Linked notes</h3>
              <ul className="related-memories">
                {memory.enrichment.relationships.map((relation) => (
                  <li key={relation.id}>
                    <Link href={`/app/memories/${relation.id}`}>
                      {related[relation.id] ?? "Related note"}
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
        {fullPage &&
          tab === "connections" &&
          !memory.enrichment?.relationships.length && (
            <div className="reader-section">
              <h3>No linked notes yet</h3>
              <p>
                Connections appear as Grove finds related ideas in this
                notebook.
              </p>
            </div>
          )}
        {(!fullPage || tab === "history") && (
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
              Updated {dateLabel(memory.updatedAt)} · revision {memory.version}{" "}
              · saved from {memory.source.agent}
            </p>
            {history && (
              <ol className="revision-list">
                {history.map((revision) => (
                  <li key={revision.version}>
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                      <span>
                        Revision {revision.version}
                        {revision.version === memory.version
                          ? " · Current"
                          : ""}
                      </span>
                      <span>{dateLabel(revision.createdAt)}</span>
                    </div>
                    {compare === revision.version ? (
                      <RevisionCompare
                        before={revision.content}
                        after={memory.content}
                        beforeLabel={`Version ${revision.version}`}
                        afterLabel={`Current · version ${memory.version}`}
                      />
                    ) : (
                      <Markdown>{revision.content}</Markdown>
                    )}
                    {revision.version !== memory.version && (
                      <button
                        className="text-button mr-4"
                        onClick={() =>
                          setCompare(
                            compare === revision.version
                              ? null
                              : revision.version,
                          )
                        }
                      >
                        {compare === revision.version
                          ? "Close comparison"
                          : "Compare with current"}
                      </button>
                    )}
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
        )}
        <details className="agent-details">
          <summary>Agent details</summary>
          <dl>
            <dt>Note reference</dt>
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
            References help connected agents return to the same note. You can
            find it here by its title and notebook.
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
                  onSaved("Grove will organize this note again.");
                })
              }
            >
              Retry processing
            </button>
          )}
        </details>
        <details className="agent-details">
          <summary>Delete note</summary>
          <p>Permanently removes this note and its history.</p>
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
                      items: [
                        { id: memory.id, expectedVersion: memory.version },
                      ],
                    })) as { results: { outcome: string }[] };
                    if (result.results[0]?.outcome !== "deleted")
                      throw new Error(
                        "This note changed. Reload it before deleting.",
                      );
                    if (onDeleted) onDeleted();
                    else onSaved("Note permanently deleted.");
                  })
                }
              >
                Delete this note
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
      </div>
      {fullPage && (
        <aside className="memory-metadata" aria-label="Note information">
          <h2>Details</h2>
          <dl>
            <dt>Notebook</dt>
            <dd>
              {projects.find((project) => project.id === memory.projectId)
                ?.name ?? "Personal"}
            </dd>
            <dt>Saved from</dt>
            <dd>
              {memory.source.agent === "website"
                ? "Written by you"
                : memory.source.agent}
            </dd>
            <dt>Created</dt>
            <dd>{dateLabel(memory.createdAt)}</dd>
            <dt>Updated</dt>
            <dd>{dateLabel(memory.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{memory.version}</dd>
            <dt>Keep for</dt>
            <dd>
              {memory.expiresAt
                ? `${memory.retentionDays ?? 30} days`
                : "Until you remove it"}
            </dd>
            {memory.expiresAt && (
              <>
                <dt>Kept until</dt>
                <dd>{dateLabel(memory.expiresAt)}</dd>
              </>
            )}
          </dl>
          {memory.source.verification && (
            <section>
              <h3>Verification</h3>
              <p>{memory.source.verification}</p>
            </section>
          )}
        </aside>
      )}
    </article>
  );
}
