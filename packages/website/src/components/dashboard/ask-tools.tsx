"use client";
import { BookOpen, FolderTree, Globe, SlidersHorizontal } from "lucide-react";
import type {
  LifecycleProposal,
  OrganizationProposal,
  ToolRun,
} from "@lib/shared/conversations";
import {
  askToolCatalog,
  askToolIds,
  type AskTools,
} from "@lib/shared/ask-tools";
export { defaultAskTools as initialTools } from "@lib/shared/ask-tools";
import type { Memory } from "@lib/shared/contracts";
import { ActionMenu } from "./ui/action-menu";
import { Button } from "./ui/button";
import { Markdown } from "./markdown";
import { useNoteDraftRevision, useNoteDrafts } from "./note-drafts";

export type ToolCapabilities = {
  defaults: AskTools;
  available: AskTools;
  dailyCalls: number;
};
const toolIcons = { exa: Globe, tavily: BookOpen, organize: FolderTree };

export function researchActivityLabel(runs?: ToolRun[]) {
  const active = runs?.find((run) => run.status === "running");
  if (active)
    return active.operation === "extract"
      ? "Reading sources…"
      : active.provider === "exa"
        ? "Searching the web…"
        : "Researching sources…";
  return runs?.length
    ? "Preparing your answer…"
    : "Looking through your notes…";
}

export function AskToolMenu({
  tools,
  available,
  busy,
  error,
  notice,
  onChange,
  onDefault,
  onRetry,
}: {
  tools: AskTools;
  available?: AskTools;
  busy: boolean;
  error?: string;
  notice?: string;
  onChange: (tools: AskTools) => void;
  onDefault: () => void;
  onRetry: () => void;
}) {
  const count = askToolIds.filter(
    (key) => tools[key] && available?.[key],
  ).length;
  return (
    <div className="ask-tools-control">
      <ActionMenu
        label="Ask Grove tools"
        closeOnSelect={false}
        icon={
          <>
            <SlidersHorizontal size={15} />
            <span>Tools{count ? ` · ${count}` : ""}</span>
          </>
        }
      >
        <div className="ask-tools-heading">For this chat</div>
        {askToolIds.map((key) => {
          const { label, description } = askToolCatalog[key];
          const Icon = toolIcons[key];
          return (
            <button
              key={key}
              type="button"
              role="switch"
              aria-checked={tools[key]}
              disabled={busy || (!available?.[key] && !tools[key])}
              onClick={() => onChange({ ...tools, [key]: !tools[key] })}
            >
              <Icon size={16} />
              <span className="ask-tool-description">
                <strong>{label}</strong>
                <small>
                  {available?.[key] ? description : "Currently unavailable"}
                </small>
              </span>
              <span
                className={`ask-tool-switch${tools[key] ? " is-on" : ""}`}
                aria-hidden="true"
              >
                <span />
              </span>
            </button>
          );
        })}
        <p className="ask-tools-status" role="status">
          {busy ? "Saving…" : notice || "Used only when helpful."}
        </p>
        <button
          className="ask-tools-default"
          type="button"
          disabled={busy || !available}
          onClick={onDefault}
        >
          Use for new chats
        </button>
        {error && (
          <p className="app-error" role="alert">
            {error}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={onRetry}
            >
              Refresh tools
            </button>
          </p>
        )}
      </ActionMenu>
    </div>
  );
}

export function OrganizationPreview({
  proposal,
  sources,
  busy,
  canApply,
  onApply,
  onUndo,
}: {
  proposal: OrganizationProposal;
  sources: Pick<Memory, "id" | "content">[];
  busy: boolean;
  canApply: boolean;
  onApply: () => void;
  onUndo: () => void;
}) {
  const destination = (id: string | null): string =>
    id === null
      ? "Unfiled"
      : id.startsWith("new:")
        ? (proposal.notebooks.find((n) => `new:${n.key}` === id)?.name ??
          "New notebook")
        : (proposal.notebookRefs.find((n) => n.id === id)?.name ?? "Notebook");
  return (
    <section
      className="ask-proposal ask-organization"
      aria-label="Proposed notebook changes"
    >
      <h3>Notebook changes</h3>
      <ul className="ask-organization-list">
        {proposal.notebooks.map((notebook) => (
          <li key={notebook.key}>
            <BookOpen size={15} />
            <span>
              Create <strong>{notebook.name}</strong>
              {notebook.parent && <> in {destination(notebook.parent)}</>}
            </span>
          </li>
        ))}
        {proposal.renames.map((notebook) => (
          <li key={notebook.id}>
            Rename {destination(notebook.id)} to{" "}
            <strong>{notebook.name}</strong>
          </li>
        ))}
        {(proposal.notebookMoves ?? []).map((notebook) => (
          <li key={`notebook-${notebook.id}`}>
            <FolderTree size={15} />
            <span>
              Move <strong>{destination(notebook.id)}</strong> to{" "}
              {notebook.destination === null
                ? "root notebooks"
                : destination(notebook.destination)}
            </span>
          </li>
        ))}
        {proposal.moves.map((note) => (
          <li key={note.id}>
            <span>
              Move{" "}
              <strong>
                {sources
                  .find((s) => s.id === note.id)
                  ?.content.split("\n")[0]
                  .replace(/^#+\s*/, "")
                  .slice(0, 100) ?? "Note"}
              </strong>{" "}
              to {destination(note.destination)}
            </span>
          </li>
        ))}
      </ul>
      {proposal.notes.map((note, index) => (
        <details key={index}>
          <summary>New note in {destination(note.destination)}</summary>
          <div className="ask-proposal-preview">
            <Markdown>{note.content}</Markdown>
          </div>
        </details>
      ))}
      {proposal.coverage.shown < proposal.coverage.total && (
        <p className="ask-answer-note">
          This batch considered {proposal.coverage.shown} of{" "}
          {proposal.coverage.total} notes.
          {proposal.coverage.nextCursor &&
            " Ask to continue with the next batch."}
        </p>
      )}
      {proposal.status === "proposed" && (
        <Button disabled={busy || !canApply} onClick={onApply}>
          Apply changes
        </Button>
      )}
      {proposal.status === "applied" && (
        <div className="ask-applied">
          <span>Changes applied</span>
          <button className="text-button" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        </div>
      )}
      {proposal.status === "undone" && <p>Changes undone.</p>}
      {proposal.status === "unavailable" && (
        <p>Ask Grove for an updated preview.</p>
      )}
    </section>
  );
}

export function LifecyclePreview({
  proposal,
  sources,
  busy,
  canApply,
  onApply,
  onUndo,
}: {
  proposal: LifecycleProposal;
  sources: Pick<Memory, "id" | "content">[];
  busy: boolean;
  canApply: boolean;
  onApply: () => void;
  onUndo: () => void;
}) {
  const drafts = useNoteDrafts();
  useNoteDraftRevision();
  const affectedIds = new Set(proposal.notes.map((note) => note.id));
  const affectedScopes = new Set(
    proposal.notebookPreviews.flatMap((preview) => preview.projectIds),
  );
  const draftCount = drafts
    ? [...drafts.entries()].filter(
        ([key, draft]) =>
          affectedIds.has(draft.base?.id ?? key.replace(/^note:/, "")) ||
          affectedScopes.has(draft.projectId) ||
          (!!draft.base?.projectId && affectedScopes.has(draft.base.projectId)),
      ).length
    : 0;
  const label = { archive: "Archive", restore: "Restore", delete: "Delete" }[
    proposal.action
  ];
  const completed = {
    archive: "Archived",
    restore: "Restored",
    delete: "Deleted",
  }[proposal.action];
  return (
    <section
      className="ask-proposal ask-organization"
      aria-label={`${label} preview`}
    >
      <h3>{label} selected items</h3>
      {proposal.status === "proposed" && (
        <>
          <ul className="ask-organization-list">
            {proposal.notes.map((note) => (
              <li key={note.id}>
                <BookOpen size={15} />
                <span>
                  {sources
                    .find((source) => source.id === note.id)
                    ?.content.split("\n")[0]
                    .replace(/^#+\s*/, "")
                    .slice(0, 100) || "Note"}
                </span>
              </li>
            ))}
            {proposal.notebookPreviews.map((preview) => (
              <li key={preview.project.id}>
                <FolderTree size={15} />
                <span>
                  <strong>{preview.project.name}</strong> — {preview.notebooks}{" "}
                  {preview.notebooks === 1 ? "notebook" : "notebooks"},{" "}
                  {preview.notes} {preview.notes === 1 ? "note" : "notes"},
                  including sub-notebooks
                </span>
              </li>
            ))}
          </ul>
          {proposal.action === "delete" && (
            <p className="ask-answer-note">
              Deleted items leave your library. This action cannot be undone
              here.
            </p>
          )}
          {!!draftCount && (
            <p className="app-error" role="alert">
              Finish saving or resolving drafts in these items first (
              {draftCount}). Your local writing will not be discarded.
            </p>
          )}
          <Button
            variant={proposal.action === "delete" ? "danger" : "primary"}
            disabled={busy || !canApply || !!draftCount}
            onClick={onApply}
          >
            {label} selected items
          </Button>
        </>
      )}
      {proposal.status === "applied" && (
        <div className="ask-applied" role="status">
          <span>{completed}</span>
          {proposal.action !== "delete" && (
            <button className="text-button" disabled={busy} onClick={onUndo}>
              Undo
            </button>
          )}
        </div>
      )}
      {proposal.status === "undone" && <p role="status">Change undone.</p>}
      {proposal.status === "unavailable" && (
        <p>Ask Grove for an updated preview.</p>
      )}
    </section>
  );
}
