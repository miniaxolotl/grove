"use client";
import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, MoreHorizontal } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { dateLabel, isInactive, memoryTitle } from "@/lib/memory-display";
import { Button, IconButton } from "./ui/button";
import { useWorkspaceDrag, type WorkspaceDragItem } from "./memory-drag";
import { NoteActions } from "./note-actions";
import { useNoteExport } from "./note-export";

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
  const [offset, setOffset] = useState(0);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    horizontal: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const title = memoryTitle(memory);
  function cancelGesture() {
    pointer.current = null;
    setOffset(0);
  }
  return (
    <li
      ref={setNodeRef}
      className="memory-list-item"
      data-note-id={memory.id}
      data-selected={selected || undefined}
      data-dragging={isDragging || undefined}
    >
      <div
        className="memory-row"
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (
            event.pointerType !== "touch" ||
            (event.target as HTMLElement).closest(
              "input, a, .drag-handle, .memory-actions, .memory-tags, .row-controls",
            )
          )
            return;
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            horizontal: false,
          };
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (
            !start.horizontal &&
            Math.abs(dy) > 12 &&
            Math.abs(dy) > Math.abs(dx)
          ) {
            cancelGesture();
            return;
          }
          if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            start.horizontal = true;
            suppressClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setOffset(Math.max(-80, Math.min(80, dx * 0.5)));
          }
        }}
        onPointerUp={(event) => {
          const start = pointer.current;
          if (start?.horizontal && Math.abs(event.clientX - start.x) > 64)
            setActions(true);
          cancelGesture();
        }}
        onPointerCancel={() => {
          suppressClick.current = true;
          cancelGesture();
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            if (event.detail > 0) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
        }}
      >
        <div className="row-selection">
          <input
            type="checkbox"
            aria-label={`Select ${title}`}
            checked={selected}
            disabled={busy}
            onChange={onSelect}
          />
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
            onClick={() => setActions(!actions)}
            aria-expanded={actions}
            label={`Actions for ${title}`}
          >
            <MoreHorizontal size={19} />
          </IconButton>
        </div>
      </div>
      {actions && (
        <div className="memory-actions" aria-label={`Actions for ${title}`}>
          <NoteActions
            row
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
          <Button variant="secondary" onClick={() => setActions(false)}>
            Close actions
          </Button>
        </div>
      )}
    </li>
  );
}
