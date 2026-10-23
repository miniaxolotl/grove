"use client";
import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import {
  dateLabel,
  isInactive,
  memoryExcerpt,
  memoryTitle,
} from "@/lib/memory-display";
import { ActionMenu } from "./ui/action-menu";
import { useWorkspaceDrag, type WorkspaceDragItem } from "./memory-drag";
import { NoteActions } from "./note-actions";
import { useNoteExport } from "./note-export";
import { useRowSwipe } from "./use-row-swipe";
import { SearchPassage } from "./search-passage";

export function MemoryRow({
  memory,
  projectName,
  selected,
  busy,
  onSelect,
  onOpen,
  onIntent,
  onDelete,
  onMove,
  onArchive,
  onTag,
  selectedItems,
  query = "",
}: {
  memory: Memory;
  projectName: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onIntent?: () => void;
  onDelete: () => void;
  onMove: () => void;
  onArchive: () => void;
  onTag: (tag: string) => void;
  selectedItems: Memory[];
  query?: string;
}) {
  const workspace = useWorkspaceDrag();
  const noteExport = useNoteExport();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: memory.id,
      data: {
        item: {
          kind: "notes",
          items: selected ? selectedItems : [memory],
        } satisfies WorkspaceDragItem,
      },
      disabled: busy || workspace.busy,
    });
  const [actions, setActions] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const swipe = useRowSwipe(
    row,
    busy || workspace.busy || !!workspace.active,
    () => setActions(true),
  );
  const title = memoryTitle(memory);
  return (
    <li
      ref={setNodeRef}
      className="memory-list-item"
      data-note-id={memory.id}
      data-selected={selected || undefined}
      data-dragging={isDragging || undefined}
    >
      <div className="memory-row" ref={row} {...swipe}>
        <div className="row-selection">
          <label className="row-checkbox">
            <input
              type="checkbox"
              aria-label={`Select ${title}`}
              checked={selected}
              disabled={busy}
              onChange={onSelect}
            />
          </label>
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            className="drag-handle"
            disabled={busy}
            title="Drag to a notebook, or press Space to move"
            aria-label={`Move ${title} with drag or keyboard`}
          >
            <GripVertical size={16} />
          </button>
        </div>
        <div className="memory-row-content">
          <button
            className="memory-open"
            disabled={busy}
            onClick={onOpen}
            onPointerEnter={onIntent}
            onFocus={onIntent}
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                event.nativeEvent.isComposing ||
                event.altKey ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey
              )
                return;
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const rows = [
                  ...event.currentTarget
                    .closest("ul")!
                    .querySelectorAll<HTMLButtonElement>(".memory-open"),
                ];
                const index = rows.indexOf(event.currentTarget);
                rows[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? rows.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            rows.length - 1,
                            index + (event.key === "ArrowDown" ? 1 : -1),
                          ),
                        )
                ]?.focus();
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                onOpen();
              }
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                if (!event.repeat) onDelete();
              }
            }}
          >
            <span className="memory-title">{title}</span>
            {(memory.enrichment?.title || query) && (
              <span className="memory-excerpt">
                {query ? (
                  <SearchPassage
                    content={memory.content}
                    query={query}
                    length={220}
                  />
                ) : (
                  memoryExcerpt(memory, 220)
                )}
              </span>
            )}
          </button>
          <div className="memory-row-details">
            <div className="memory-meta">
              {memory.kind !== "fact" && (
                <span className="memory-kind">
                  {memory.kind === "handoff"
                    ? "Progress"
                    : memory.kind === "solution"
                      ? "How-to"
                      : memory.kind}
                </span>
              )}
              {memory.expiresAt && (
                <span>Until {dateLabel(memory.expiresAt)}</span>
              )}
              <span className="memory-notebook" title={projectName}>
                {projectName}
              </span>
              <time dateTime={memory.updatedAt}>
                {dateLabel(memory.updatedAt)}
              </time>
              {(memory.indexing === "pending" ||
                memory.enrichment?.status === "pending") && (
                <span>Organizing…</span>
              )}
              {(memory.indexing === "failed" ||
                memory.enrichment?.status === "failed") && (
                <span>Needs attention</span>
              )}
            </div>
            {!!memory.enrichment?.tags.length && (
              <div className="memory-tags">
                {memory.enrichment.tags.slice(0, 3).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => onTag(tag)}
                    aria-label={`Filter by ${tag}`}
                  >
                    {tag}
                  </button>
                ))}
                {memory.enrichment.tags.length > 3 && (
                  <span>+{memory.enrichment.tags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="row-controls">
          <ActionMenu
            open={actions && !workspace.active}
            onOpenChange={setActions}
            label={`Actions for ${title}`}
          >
            <NoteActions
              inactive={isInactive(memory)}
              locked={busy}
              busy={busy}
              onMove={onMove}
              onArchive={onArchive}
              onDelete={onDelete}
              onExport={() =>
                noteExport.open({ key: `note:${memory.id}`, note: memory })
              }
            />
          </ActionMenu>
        </div>
      </div>
    </li>
  );
}
