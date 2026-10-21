"use client";
import { useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Archive,
  ArchiveRestore,
  FolderInput,
  GripVertical,
  MoreHorizontal,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { dateLabel, isInactive, memoryTitle } from "@/lib/memory-display";
import { Button, IconButton } from "./ui/button";
import { useWorkspaceDrag, type WorkspaceDragItem } from "./memory-drag";
import { useRowSwipe } from "./use-row-swipe";

export function MemoryRow({
  memory,
  projectName,
  selected,
  busy,
  onSelect,
  onOpen,
  onDelete,
  onMove,
  onArchive,
  onTag,
  selectedItems,
  actions,
  setActions,
}: {
  memory: Memory;
  projectName: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onMove: () => void;
  onArchive: () => void;
  onTag: (tag: string) => void;
  selectedItems: Memory[];
  actions: boolean;
  setActions: (open: boolean) => void;
}) {
  const workspace = useWorkspaceDrag();
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
  const root = useRef<HTMLLIElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const swipe = useRowSwipe(
    row,
    busy || workspace.busy || !!workspace.active,
    () => setActions(true),
  );
  const title = memoryTitle(memory);
  useEffect(() => {
    if (!actions) return;
    if (workspace.active) {
      setActions(false);
      return;
    }
    const outside = (event: MouseEvent) => {
      if ((event.target as Element).closest(".row-controls")) return;
      if (!root.current?.contains(event.target as Node)) setActions(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector("dialog[open], [popover]:popover-open")
      )
        return;
      event.preventDefault();
      setActions(false);
      actionButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [actions, setActions, workspace.active]);
  return (
    <li
      ref={(element) => {
        root.current = element;
        setNodeRef(element);
      }}
      className="memory-list-item"
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
            {memory.enrichment?.title && (
              <span className="memory-excerpt">
                {memory.content
                  .replace(/^\s*#{1,6}\s+[^\n]+\n+/, "")
                  .replace(/[#*`_[\]]/g, "")
                  .slice(0, 220)}
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
          <IconButton
            ref={actionButton}
            onClick={() => setActions(!actions)}
            aria-expanded={actions}
            label={`Actions for ${title}`}
          >
            <MoreHorizontal size={19} />
          </IconButton>
        </div>
      </div>
      {actions && (
        <div
          className="memory-actions"
          role="group"
          aria-label={`Actions for ${title}`}
        >
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              actionButton.current?.focus({ preventScroll: true });
              setActions(false);
              onMove();
            }}
          >
            <FolderInput size={15} />
            Move
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              actionButton.current?.focus({ preventScroll: true });
              setActions(false);
              onArchive();
            }}
          >
            {isInactive(memory) ? (
              <ArchiveRestore size={15} />
            ) : (
              <Archive size={15} />
            )}
            {isInactive(memory) ? "Restore" : "Archive"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setActions(false);
              actionButton.current?.focus({ preventScroll: true });
            }}
          >
            Close actions
          </Button>
        </div>
      )}
    </li>
  );
}
