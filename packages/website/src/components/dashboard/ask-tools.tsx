"use client";
import { BookOpen, FolderTree, Globe, SlidersHorizontal } from "lucide-react";
import type { AskTools, OrganizationProposal } from "@lib/shared/conversations";
import type { Memory } from "@lib/shared/contracts";
import { ActionMenu } from "./ui/action-menu";
import { Button } from "./ui/button";
import { Markdown } from "./markdown";

export type ToolCapabilities = {
  defaults: AskTools;
  available: AskTools;
  dailyCalls: number;
};
export const initialTools: AskTools = {
  exa: true,
  tavily: false,
  organize: true,
};

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
  const count = Object.entries(tools).filter(
    ([key, enabled]) => enabled && available?.[key as keyof AskTools],
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
        {(
          [
            ["exa", "Web search", "Find current information online", Globe],
            ["tavily", "Research", "Explore topics and read sources", BookOpen],
            [
              "organize",
              "Manage notes",
              "Edit notes and organize notebooks",
              FolderTree,
            ],
          ] as const
        ).map(([key, title, description, Icon]) => (
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
              <strong>{title}</strong>
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
        ))}
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
