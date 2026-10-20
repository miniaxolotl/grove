"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { FolderInput } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { memoryTitle } from "@/lib/memory-display";

const destinationCoordinates: KeyboardCoordinateGetter = (
  event,
  { context },
) => {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.code))
    return;
  event.preventDefault();
  const targets = context.droppableContainers
    .getEnabled()
    .filter((target) => context.droppableRects.has(target.id));
  if (!targets.length || !context.collisionRect) return;
  const current = targets.findIndex((target) => target.id === context.over?.id);
  const step = event.code === "ArrowUp" || event.code === "ArrowLeft" ? -1 : 1;
  const next = targets[(current + step + targets.length) % targets.length];
  const rect = context.droppableRects.get(next.id)!;
  return {
    x: rect.left + 4,
    y: rect.top + 4,
  };
};

export function MemoryDrag({
  items,
  selected,
  busy,
  onMove,
  children,
}: {
  items: Memory[];
  selected: string[];
  busy: boolean;
  onMove: (memories: Memory[], projectId: string | null) => void;
  children: ReactNode;
}) {
  const [dragged, setDragged] = useState<Memory[]>([]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: destinationCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const hits = pointerWithin({
          ...args,
          pointerCoordinates: args.pointerCoordinates ?? {
            x: args.collisionRect.left + 8,
            y: args.collisionRect.top + 8,
          },
        });
        return args.pointerCoordinates || hits.length
          ? hits
          : rectIntersection(args);
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Press Space to pick up a note. Use the arrow keys to choose a notebook, then Space to move. Escape cancels.",
        },
        announcements: {
          onDragStart: () => "Note picked up. Choose a notebook.",
          onDragOver: ({ over }) =>
            over
              ? `Move to ${over.data.current?.name}.`
              : "Choose a notebook for this note.",
          onDragEnd: ({ over }) =>
            over ? `Moving to ${over.data.current?.name}.` : "Move cancelled.",
          onDragCancel: () => "Move cancelled.",
        },
      }}
      onDragStart={({ active }) => {
        if (busy) return;
        const memory = items.find((item) => item.id === active.id);
        if (memory)
          setDragged(
            selected.includes(memory.id)
              ? items.filter((item) => selected.includes(item.id))
              : [memory],
          );
      }}
      onDragCancel={() => setDragged([])}
      onDragEnd={({ over }) => {
        if (over && dragged.length && !busy)
          onMove(dragged, over.id === "personal" ? null : String(over.id));
        setDragged([]);
      }}
    >
      <div data-dragging={dragged.length > 0 || undefined}>{children}</div>
      <DragOverlay
        dropAnimation={
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? null
            : { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
        }
      >
        {dragged.length > 0 && (
          <div className="memory-drag-preview">
            <FolderInput size={20} />
            <span>
              <strong>
                {dragged.length > 1
                  ? `${dragged.length} notes`
                  : memoryTitle(dragged[0])}
              </strong>
              <small>Drop into a notebook to move</small>
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

export function MemoryDestination({
  id,
  name,
  active,
  busy,
  onClick,
  children,
  href,
}: {
  id: string;
  name: string;
  active: boolean;
  busy: boolean;
  onClick: () => void;
  children: ReactNode;
  href?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { name },
    disabled: busy,
  });
  if (href)
    return (
      <Link
        ref={setNodeRef}
        href={href}
        className="memory-destination-link"
        aria-current={active ? "page" : undefined}
        data-drop-active={isOver || undefined}
        data-destination={id}
        title={name}
      >
        {children}
        <span>{name}</span>
      </Link>
    );
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-pressed={active}
      data-drop-active={isOver || undefined}
      data-destination={id}
      title={name}
      onClick={onClick}
    >
      {children}
      <span>{name}</span>
    </button>
  );
}
