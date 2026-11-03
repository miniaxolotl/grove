"use client";

import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Eye, FileText, X } from "lucide-react";
import type { ConversationContext } from "@lib/shared/conversations";
import { memoryExcerpt, memoryTitle } from "@/lib/memory-display";
import { notebookPath } from "@/lib/notebooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useWorkspaceCache } from "./workspace-cache";
import { useNotebooks } from "./notebooks-provider";
import { PaletteDialog } from "./ui/palette-dialog";
import { SegmentedControl } from "./ui/segmented-control";
import { LoadError } from "./load-error";
import { Dialog } from "./dialog";
import { Markdown } from "./markdown";

export type SourceSelection = {
  context: ConversationContext;
  labels: Record<string, string>;
};

export function SelectedSources({
  selection,
  onChange,
  disabled,
  replace,
}: {
  selection: SourceSelection;
  onChange: (selection?: SourceSelection) => void;
  disabled: boolean;
  replace: () => void;
}) {
  const { context, labels } = selection;
  return (
    <div className="ask-selected-sources">
      <div className="ask-source-chips" aria-label="Selected sources">
        {(["notes", "notebooks"] as const).flatMap((kind) =>
          context[kind].map((id) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              aria-label={`Remove ${kind === "notes" ? "note" : "notebook"}: ${labels[id] ?? "Unavailable source"}`}
              onClick={() => {
                const next = {
                  ...context,
                  [kind]: context[kind].filter((source) => source !== id),
                };
                onChange({ context: next, labels });
              }}
            >
              {kind === "notes" ? (
                <FileText size={14} />
              ) : (
                <BookOpen size={14} />
              )}
              <span>{labels[id] ?? "Unavailable source"}</span>
              <X size={13} />
            </button>
          )),
        )}
      </div>
      <label className="ask-source-only">
        <input
          type="checkbox"
          checked={context.only}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...selection,
              context: { ...context, only: event.target.checked },
            })
          }
        />
        Use only these sources
      </label>
      <p>
        {!context.notes.length && !context.notebooks.length
          ? "Choose sources before sending, or explicitly return to automatic sources."
          : context.only
            ? "This question only. No web or previous answers. Edits still need review."
            : "Selected sources plus automatic retrieval and enabled tools."}
      </p>
      <div className="ask-source-actions">
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={replace}
        >
          Add or replace sources
        </button>
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => onChange(undefined)}
        >
          Use automatic sources
        </button>
      </div>
    </div>
  );
}

export function AskSourcePicker({
  selection,
  onChange,
  close,
  initialKind,
  scope,
  includePersonal,
}: {
  selection?: SourceSelection;
  onChange: (selection: SourceSelection) => void;
  close: () => void;
  initialKind: "notes" | "notebooks";
  scope: string;
  includePersonal: boolean;
}) {
  const [kind, setKind] = useState(initialKind);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<string>();
  const search = useDebouncedValue(query.trim());
  const cache = useWorkspaceCache();
  const {
    projects,
    error: projectsError,
    loading: projectsLoading,
    reload,
  } = useNotebooks();
  const path = (id: string | null) =>
    notebookPath(projects, id)
      .map((book) => book.name)
      .join(" / ") || "Unfiled";
  const projectId =
    scope === "all" ? undefined : scope === "personal" ? null : scope;
  const notes = useInfiniteQuery({
    ...cache.notes({ projectId, query: search || undefined, limit: 30 }),
    enabled: kind === "notes",
  });
  const personal = useInfiniteQuery({
    ...cache.notes({ projectId: null, query: search || undefined, limit: 30 }),
    enabled: kind === "notes" && includePersonal && !!projectId,
  });
  const withPersonal = includePersonal && !!projectId;
  const pending =
    query.trim() !== search ||
    notes.isPending ||
    (withPersonal && personal.isPending);
  const error = notes.error || (withPersonal && personal.error);
  const candidates =
    kind === "notes"
      ? [
          ...(notes.data?.pages.flatMap((p) => p.items) ?? []),
          ...(withPersonal
            ? (personal.data?.pages.flatMap((p) => p.items) ?? [])
            : []),
        ].map((note) => ({
          id: note.id,
          label: memoryTitle(note),
          detail: path(note.projectId),
          excerpt: memoryExcerpt(note),
          updatedAt: note.updatedAt,
        }))
      : projects
          .filter(
            (book) =>
              book.status === "active" &&
              (scope === "all" || book.id === projectId) &&
              path(book.id)
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
          )
          .map((book) => ({
            id: book.id,
            label: book.name,
            detail: `${path(book.id)} · Direct notes only`,
            excerpt:
              "Relevant notes are retrieved within this notebook. Large notebooks may have partial coverage.",
            updatedAt: undefined,
          }));
  const count =
    (selection?.context.notes.length ?? 0) +
    (selection?.context.notebooks.length ?? 0);
  function toggle(id: string, label: string) {
    const context = selection?.context ?? {
      notes: [],
      notebooks: [],
      only: true,
    };
    const selected = context[kind].includes(id);
    if (!selected && context[kind].length >= (kind === "notes" ? 12 : 6)) {
      setNotice(`Choose at most ${kind === "notes" ? 12 : 6} ${kind}.`);
      return;
    }
    setNotice("");
    onChange({
      context: {
        ...context,
        [kind]: selected
          ? context[kind].filter((item) => item !== id)
          : [...context[kind], id],
      },
      labels: { ...selection?.labels, [id]: label },
    });
  }
  return (
    <>
      <PaletteDialog
        title="Choose sources"
        close={close}
        search={{
          label: "Find a source",
          value: query,
          onChange: setQuery,
          placeholder: kind === "notes" ? "Find a note…" : "Find a notebook…",
        }}
        footer={
          <>
            <span>
              {count ? `${count} selected` : "Choose notes or notebooks"} · Up
              to 12 notes provided per answer
            </span>
            <button className="text-button" type="button" onClick={close}>
              Done
            </button>
          </>
        }
      >
        <div className="palette-toolbar">
          <SegmentedControl
            label="Source type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "notes", label: "Notes" },
              { value: "notebooks", label: "Notebooks" },
            ]}
          />
        </div>
        <div className="ask-source-results">
          {(kind === "notes" ? error : projectsError) ? (
            <LoadError
              title="Sources couldn’t load"
              message="Try loading your sources again."
              retry={() => {
                if (kind === "notebooks") reload();
                else {
                  void notes.refetch();
                  if (withPersonal) void personal.refetch();
                }
              }}
            />
          ) : (kind === "notes" ? pending : projectsLoading) ? (
            <p role="status">Finding sources…</p>
          ) : candidates.length ? (
            candidates.map(({ id, label, detail, excerpt, updatedAt }) => (
              <div key={id} className="ask-source-row">
                <button
                  type="button"
                  className="ask-source-result"
                  aria-pressed={selection?.context[kind].includes(id) ?? false}
                  onClick={() => toggle(id, label)}
                >
                  {kind === "notes" ? (
                    <FileText size={17} />
                  ) : (
                    <BookOpen size={17} />
                  )}
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {detail}
                      {updatedAt
                        ? ` · ${new Date(updatedAt).toLocaleDateString()}`
                        : ""}
                    </small>
                    <small className="ask-source-excerpt">{excerpt}</small>
                  </span>
                  {selection?.context[kind].includes(id) && <Check size={17} />}
                </button>
                {kind === "notes" && (
                  <button
                    type="button"
                    className="app-icon"
                    aria-label={`Preview note: ${label}`}
                    title="Preview note"
                    onClick={() => setPreview(id)}
                  >
                    <Eye size={17} />
                  </button>
                )}
              </div>
            ))
          ) : (
            <p>No matching {kind}. Try another name or conversation scope.</p>
          )}
          {kind === "notes" &&
            !pending &&
            (notes.hasNextPage || (withPersonal && personal.hasNextPage)) && (
              <button
                type="button"
                className="text-button"
                disabled={
                  notes.isFetchingNextPage || personal.isFetchingNextPage
                }
                onClick={() => {
                  if (notes.hasNextPage) void notes.fetchNextPage();
                  if (withPersonal && personal.hasNextPage)
                    void personal.fetchNextPage();
                }}
              >
                More notes
              </button>
            )}
          {notice && (
            <p className="app-error" role="alert">
              {notice}
            </p>
          )}
        </div>
      </PaletteDialog>
      {preview && (
        <SourcePreview id={preview} close={() => setPreview(undefined)} />
      )}
    </>
  );
}

function SourcePreview({ id, close }: { id: string; close: () => void }) {
  const cache = useWorkspaceCache();
  const note = useQuery(cache.note(id));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!note.data?.expiresAt) return;
    if (new Date(note.data.expiresAt).getTime() <= now) return;
    const remaining = new Date(note.data.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(remaining, 0), 2147483647),
    );
    return () => clearTimeout(timer);
  }, [note.data?.expiresAt, now]);
  const unavailable =
    note.error ||
    note.data === null ||
    note.data?.status === "archived" ||
    (note.data?.expiresAt && new Date(note.data.expiresAt).getTime() <= now);
  return (
    <Dialog title="Source preview" variant="inspector" close={close}>
      <div className="inspector-body ask-source-preview">
        {unavailable ? (
          <p>
            This source is no longer available. Close the preview and choose
            another note.
          </p>
        ) : note.data ? (
          <div>
            <p className="ask-context-summary">
              Read-only preview · version {note.data.version}
            </p>
            <Markdown>{note.data.content}</Markdown>
          </div>
        ) : (
          <p role="status">Opening source…</p>
        )}
      </div>
    </Dialog>
  );
}
