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
  const wasChoosing = useRef(false);
  useEffect(() => {
    if (notebooks.choosingDestination) wasChoosing.current = true;
    else if (wasChoosing.current && !notebooks.organizationBusy) {
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
        <h2>
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
            cancel={() => notebooks.setChoosingDestination(false)}
            done={() => notebooks.setChoosingDestination(false)}
          />
        ) : (
          <>
            <div className="notebook-organizer-body">
              <div className="notebook-organizer-browser">
                <SearchField
                  label="Find notebook to organize"
                  value={query}
                  onChange={setQuery}
                  placeholder="Find a notebook…"
                  disabled={notebooks.organizationBusy}
                />
                <p className="notebook-organizer-caption" role="status">
                  {notebooks.loading
                    ? "Loading notebooks…"
                    : query.trim()
                      ? `${matches} ${matches === 1 ? "match" : "matches"}`
                      : `${notebooks.projects.length} notebooks in saved order`}
                </p>
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
                    In{" "}
                    {parent
                      ? notebookPath(notebooks.projects, parent.id)
                          .map((p) => p.name)
                          .join(" / ")
                      : "Top level"}
                  </p>
                  <p className="notebook-sibling-position">
                    Position {index + 1} of {siblings.length}
                  </p>
                  <div className="notebook-position-controls">
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={locked || !!query.trim() || index <= 0}
                      onClick={() =>
                        void notebooks.organize(project, {
                          parentId: project.parentId ?? null,
                          beforeId: siblings[index - 1].id,
                        })
                      }
                    >
                      <ArrowUp size={16} />
                      Move up
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={
                        locked ||
                        !!query.trim() ||
                        index < 0 ||
                        index >= siblings.length - 1
                      }
                      onClick={() =>
                        void notebooks.organize(project, {
                          parentId: project.parentId ?? null,
                          afterId: siblings[index + 1].id,
                        })
                      }
                    >
                      <ArrowDown size={16} />
                      Move down
                    </button>
                  </div>
                  {!!query.trim() && (
                    <p className="notebook-reorder-help">
                      <button
                        className="text-button"
                        type="button"
                        disabled={notebooks.organizationBusy}
                        onClick={() => setQuery("")}
                      >
                        Clear search
                      </button>{" "}
                      to rearrange the full sibling group.
                    </p>
                  )}
                  <div className="notebook-location-controls">
                    <button
                      ref={moveButton}
                      type="button"
                      className="app-button"
                      disabled={locked}
                      onClick={() => notebooks.setChoosingDestination(true)}
                    >
                      <FolderInput size={16} />
                      Move to…
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={locked || !parent}
                      onClick={() =>
                        parent &&
                        void notebooks.organize(project, {
                          parentId: parent.parentId ?? null,
                          afterId: parent.id,
                        })
                      }
                    >
                      <CornerUpLeft size={16} />
                      Move out
                    </button>
                  </div>
                  <p className="notebook-organizer-intro">
                    Move to another notebook or choose an exact position.
                    Sub-notebooks move with it.
                  </p>
                </section>
              ) : (
                <div className="notebook-organizer-empty notebook-organizer-prompt">
                  <FolderInput size={24} aria-hidden="true" />
                  <h3>
                    {notebooks.organizing
                      ? "Notebook unavailable"
                      : "Choose a notebook"}
                  </h3>
                  <p>
                    {notebooks.organizing
                      ? "Choose another notebook from the current list."
                      : "Select a notebook to move, nest or rearrange it."}
                  </p>
                </div>
              )}
              {notebooks.error && (
                <p role="alert">
                  {notebooks.error}{" "}
                  <button type="button" onClick={notebooks.reload}>
                    Retry notebooks
                  </button>
                </p>
              )}
            </div>
            <div className="notebook-organizer-done">
              <p>Changes save as you go.</p>
              <button
                className="app-button"
                type="button"
                disabled={notebooks.organizationBusy}
                onClick={notebooks.closeOrganizer}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
