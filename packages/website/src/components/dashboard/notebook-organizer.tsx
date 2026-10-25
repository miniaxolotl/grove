"use client";
import { useState } from "react";
import { ArrowUp, ArrowDown, CornerUpLeft, FolderInput } from "lucide-react";
import { useNotebooks } from "./notebooks-provider";
import { notebookOrder, notebookPath } from "@/lib/notebooks";
import { Dialog } from "./dialog";
import { NotebookTree } from "./notebook-tree";
import { NotebookMove } from "./notebook-move";
import { SearchField } from "./ui/search-field";

export function NotebookOrganizer() {
  const notebooks = useNotebooks();
  const [query, setQuery] = useState("");
  if (notebooks.organizing === undefined) return null;
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
            <p className="notebook-organizer-intro">
              Choose a notebook to move, nest or rearrange it.
            </p>
            <SearchField
              label="Find notebook to organize"
              value={query}
              onChange={setQuery}
              placeholder="Find a notebook…"
            />
            <div className="notebook-organizer-list">
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
                    {p.name}
                  </button>
                )}
              />
            </div>
            {project && (
              <section
                className="notebook-organization-controls"
                aria-label={`Organize ${project.name}`}
              >
                <h3>{project.name}</h3>
                <p>
                  In{" "}
                  {parent
                    ? notebookPath(notebooks.projects, parent.id)
                        .map((p) => p.name)
                        .join(" / ")
                    : "Top level"}
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
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={locked}
                    onClick={() => notebooks.setChoosingDestination(true)}
                  >
                    <FolderInput size={16} />
                    Nest inside…
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
                {!!query.trim() && (
                  <p>Clear search to rearrange the complete sibling group.</p>
                )}
                <button
                  className="text-button"
                  type="button"
                  disabled={locked}
                  onClick={() => notebooks.setChoosingDestination(true)}
                >
                  Choose destination and position…
                </button>
              </section>
            )}
            {notebooks.error && (
              <p role="alert">
                {notebooks.error}{" "}
                <button type="button" onClick={notebooks.reload}>
                  Retry notebooks
                </button>
              </p>
            )}
            <div className="notebook-organizer-done">
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
