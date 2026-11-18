"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  CornerUpLeft,
  FolderInput,
  Check,
} from "lucide-react";
import { useNotebooks } from "./notebooks-provider";
import { notebookOrder, notebookPath } from "@/lib/notebooks";
import { Dialog } from "./dialog";
import { NotebookTree } from "./notebook-tree";
import { NotebookMove } from "./notebook-move";
import { SearchField } from "./ui/search-field";

export function NotebookOrganizer() {
  const notebooks = useNotebooks();
  if (notebooks.organizing === undefined) return null;
  return <OrganizerContent />;
}

function OrganizerContent() {
  const notebooks = useNotebooks();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const selectionTitle = useRef<HTMLHeadingElement>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  const wasChoosing = useRef(false);
  useEffect(() => {
    if (notebooks.choosingDestination && !wasChoosing.current) {
      dialogTitle.current?.focus({ preventScroll: true });
      wasChoosing.current = true;
    } else if (
      !notebooks.choosingDestination &&
      wasChoosing.current &&
      !notebooks.organizationBusy
    ) {
      const target = moveButton.current?.disabled
        ? selectionTitle.current
        : moveButton.current;
      target?.focus({ preventScroll: true });
      wasChoosing.current = false;
    }
  }, [notebooks.choosingDestination, notebooks.organizationBusy]);
  const project = notebooks.projects.find((p) => p.id === notebooks.organizing);
  const siblings = project
    ? notebooks.projects
        .filter((p) => (p.parentId ?? null) === (project.parentId ?? null))
        .sort(notebookOrder)
    : [];
  const index = project ? siblings.findIndex((p) => p.id === project.id) : -1;
  const parent = project?.parentId
    ? notebooks.projects.find((p) => p.id === project.parentId)
    : undefined;
  const locked = notebooks.organizationLocked || notebooks.refreshing;
  const matches = notebooks.projects.filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).length;
  function place(placement: Parameters<typeof notebooks.organize>[1]) {
    if (!project || locked) return;
    // The pressed shortcut can disappear at the new boundary. Keep keyboard
    // focus in this selection while the optimistic order and receipt settle.
    selectionTitle.current?.focus({ preventScroll: true });
    void notebooks.organize(project, placement);
  }
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    // Keep the selected row visible when opening or resizing, without scrolling
    // the surrounding controls or following the user's own list scrolling.
    const reveal = () => {
      const selected = element.querySelector('[aria-pressed="true"]');
      if (!selected) return;
      const row = selected.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      if (row.top < bounds.top) element.scrollTop += row.top - bounds.top;
      else if (row.bottom > bounds.bottom)
        element.scrollTop += row.bottom - bounds.bottom;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [
    project?.id,
    project?.parentId,
    index,
    query,
    notebooks.choosingDestination,
    notebooks.layoutReview,
  ]);
  return (
    <Dialog
      title={
        notebooks.choosingDestination && project
          ? "Move notebook"
          : "Organize notebooks"
      }
      close={notebooks.closeOrganizer}
      busy={notebooks.organizationBusy}
      variant="inspector"
      header={
        <h2 ref={dialogTitle} tabIndex={-1} data-autofocus>
          {notebooks.choosingDestination && project
            ? "Move notebook"
            : "Organize notebooks"}
        </h2>
      }
    >
      <div className="notebook-organizer">
        {notebooks.choosingDestination && project ? (
          <NotebookMove
            key={`${project.id}:${notebooks.layoutReview}`}
            project={project}
            focusSearch={false}
            cancel={() => notebooks.setChoosingDestination(false)}
            done={() => notebooks.setChoosingDestination(false)}
          />
        ) : (
          <div className="notebook-organizer-body">
            <div className="notebook-organizer-browser">
              <SearchField
                label="Find notebook to organize"
                value={query}
                onChange={setQuery}
                placeholder="Find a notebook…"
                disabled={notebooks.organizationBusy}
              />
              {(notebooks.loading || !!query.trim()) && (
                <p className="notebook-organizer-caption" role="status">
                  {notebooks.loading
                    ? "Loading notebooks…"
                    : `${matches} ${matches === 1 ? "match" : "matches"}`}
                </p>
              )}
              <div
                ref={list}
                className="notebook-organizer-list"
                role="region"
                aria-label="Notebooks to organize"
              >
                <NotebookTree
                  projects={notebooks.projects}
                  query={query}
                  defaultExpanded
                  draggable={false}
                  selectedId={project?.id}
                  renderItem={(p) => (
                    <button
                      className="notebook-organizer-choice"
                      type="button"
                      aria-pressed={p.id === project?.id}
                      disabled={notebooks.organizationBusy}
                      onClick={() => notebooks.openOrganizer(p.id)}
                    >
                      <span>{p.name}</span>
                      {p.id === project?.id && (
                        <Check size={16} aria-hidden="true" />
                      )}
                    </button>
                  )}
                />
                {!notebooks.loading && !notebooks.error && !matches && (
                  <div className="notebook-organizer-empty">
                    <p>
                      {query.trim()
                        ? "No notebooks match your search."
                        : "No notebooks to organize yet."}
                    </p>
                    {query.trim() && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setQuery("")}
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {project ? (
              <section
                className="notebook-organization-controls"
                aria-label={`Organize ${project.name}`}
              >
                <h3 ref={selectionTitle} tabIndex={-1}>
                  {project.name}
                </h3>
                <p>
                  {parent
                    ? `In ${notebookPath(notebooks.projects, parent.id)
                        .map((p) => p.name)
                        .join(" / ")}`
                    : "Top level"}
                  {siblings.length > 1 &&
                    ` · ${index + 1} of ${siblings.length}`}
                </p>
                <div className="notebook-placement-actions">
                  <button
                    ref={moveButton}
                    type="button"
                    className="app-button"
                    disabled={locked}
                    onClick={() => notebooks.setChoosingDestination(true)}
                  >
                    <FolderInput size={16} /> Move to…
                  </button>
                  {!query.trim() && index > 0 && (
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={locked}
                      onClick={() =>
                        place({
                          parentId: project.parentId ?? null,
                          beforeId: siblings[index - 1].id,
                        })
                      }
                    >
                      <ArrowUp size={16} />
                      Move up
                    </button>
                  )}
                  {!query.trim() &&
                    index >= 0 &&
                    index < siblings.length - 1 && (
                      <button
                        type="button"
                        className="app-button secondary"
                        disabled={locked}
                        onClick={() =>
                          place({
                            parentId: project.parentId ?? null,
                            afterId: siblings[index + 1].id,
                          })
                        }
                      >
                        <ArrowDown size={16} />
                        Move down
                      </button>
                    )}
                  {parent && (
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={locked}
                      onClick={() =>
                        place({
                          parentId: parent.parentId ?? null,
                          afterId: parent.id,
                        })
                      }
                    >
                      <CornerUpLeft size={16} />
                      Move out
                    </button>
                  )}
                </div>
              </section>
            ) : notebooks.organizing && !notebooks.loading ? (
              <p role="status">
                Notebook unavailable. Choose another notebook.
              </p>
            ) : null}
            {notebooks.error && (
              <p role="alert">
                {notebooks.error}{" "}
                <button type="button" onClick={notebooks.reload}>
                  Retry notebooks
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
