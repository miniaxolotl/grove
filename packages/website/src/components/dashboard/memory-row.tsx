"use client";
import { useRef, useState, type DragEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  FolderInput,
  GripVertical,
  MoreHorizontal,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { dateLabel, isInactive, memoryTitle } from "@/lib/memory-display";

export function MemoryRow({
  memory,
  projectName,
  selected,
  busy,
  onSelect,
  onOpen,
  onMove,
  onArchive,
  onTag,
  onDrag,
}: {
  memory: Memory;
  projectName: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMove: () => void;
  onArchive: () => void;
  onTag: (tag: string) => void;
  onDrag: (event: DragEvent, memory: Memory) => void;
}) {
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
    <li className="memory-list-item" data-selected={selected || undefined}>
      <div
        className="memory-row"
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (
            event.pointerType !== "touch" ||
            (event.target as HTMLElement).closest(
              "input, a, .memory-actions, .memory-tags, .row-controls",
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
          <span
            className="drag-handle"
            draggable={!busy}
            onDragStart={(event) => onDrag(event, memory)}
            title="Drag to a project"
            aria-hidden="true"
          >
            <GripVertical size={16} />
          </span>
        </div>
        <div className="memory-row-content">
          <button className="memory-open" disabled={busy} onClick={onOpen}>
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
          <div className="memory-meta">
            <span>{memory.kind === "handoff" ? "Handoff" : memory.kind}</span>
            <span>{projectName}</span>
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
        <div className="row-controls">
          <button
            className="app-icon"
            onClick={() => setActions(!actions)}
            aria-expanded={actions}
            aria-label={`Actions for ${title}`}
          >
            <MoreHorizontal size={19} />
          </button>
        </div>
      </div>
      {actions && (
        <div className="memory-actions" aria-label={`Actions for ${title}`}>
          <button
            className="app-button secondary"
            disabled={busy}
            onClick={onMove}
          >
            <FolderInput size={15} />
            Move
          </button>
          <button
            className="app-button secondary"
            disabled={busy}
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
            onClick={() => setActions(false)}
          >
            Close actions
          </button>
        </div>
      )}
    </li>
  );
}
