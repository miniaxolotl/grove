"use client";
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  pointerWithin,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { FolderInput, GripVertical, Undo2, X } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { useWorkspaceApi } from "./workspace-cache";
import { memoryTitle, moveMemoryInput } from "@/lib/memory-display";
import { notebookPath, notebookOptions } from "@/lib/notebooks";
import { useNotebooks } from "./notebooks-provider";

export type WorkspaceDragItem =
  | { kind: "notes"; items: Memory[] }
  | { kind: "notebook"; project: Project };
type Undo =
  | { kind: "notes"; before: Memory; after: Memory }
  | { kind: "notebook"; before: Project; after: Project };
const Context = createContext<{
  active: WorkspaceDragItem | null;
  busy: boolean;
}>({ active: null, busy: false });
export const useWorkspaceDrag = () => useContext(Context);

const destinationCoordinates: KeyboardCoordinateGetter = (
  event,
  { context },
) => {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.code))
    return;
  event.preventDefault();
  const targets = context.droppableContainers.getEnabled().filter((target) => {
    const rect = context.droppableRects.get(target.id);
    return rect && rect.width > 0 && rect.height > 0;
  });
  if (!targets.length) return;
  const current = targets.findIndex((target) => target.id === context.over?.id);
  const step = event.code === "ArrowUp" || event.code === "ArrowLeft" ? -1 : 1;
  const next = targets[(current + step + targets.length) % targets.length];
  const rect = context.droppableRects.get(next.id)!;
  return { x: rect.left + 4, y: rect.top + 4 };
};

/** One drag surface spans navigation, notes and notebook organization. */
export function WorkspaceDrag({ children }: { children: ReactNode }) {
  const api = useWorkspaceApi();
  const notebooks = useNotebooks();
  const [active, setActive] = useState<WorkspaceDragItem | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [notice, setNotice] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [undo, setUndo] = useState<Undo[]>([]);
  const operations = useRef(new Map<string, string>());
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: destinationCoordinates }),
  );
  async function moveNote(note: Memory, projectId: string | null) {
    const body = moveMemoryInput(note, projectId);
    const key = JSON.stringify(body);
    if (!operations.current.has(key))
      operations.current.set(key, crypto.randomUUID());
    const saved = await api<Memory>("/memories", {
      ...body,
      operationId: operations.current.get(key),
    });
    // A replay can return a newer note. Undo may only replace our own revision.
    return { ...saved, version: note.version + 1 };
  }
  async function moveNotebook(project: Project, parentId: string | null) {
    const saved = await api<Project>(
      `/projects/${project.id}`,
      {
        name: project.name,
        identity: project.identity,
        parentId,
        expectedVersion: project.version,
      },
      "PATCH",
    );
    return saved;
  }
  async function move(item: WorkspaceDragItem, destination: string | null) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    setFailures([]);
    setUndo([]);
    const completed: Undo[] = [];
    const errors: string[] = [];
    if (item.kind === "notebook") {
      try {
        if (
          item.project.parentId !== destination &&
          !notebookPath(notebooks.projects, destination).some(
            (p) => p.id === item.project.id,
          )
        ) {
          const after = await moveNotebook(item.project, destination);
          completed.push({ kind: "notebook", before: item.project, after });
        }
      } catch (error) {
        errors.push(`${item.project.name}: ${errorMessage(error)}`);
        notebooks.reload();
      }
    } else {
      for (const before of item.items
        .filter((note) => note.projectId !== destination)
        .slice(0, 50)) {
        try {
          completed.push({
            kind: "notes",
            before,
            after: await moveNote(before, destination),
          });
        } catch (error) {
          errors.push(`${memoryTitle(before)}: ${errorMessage(error)}`);
        }
      }
    }
    setUndo(completed);
    setFailures(errors);
    const name = destination
      ? notebookPath(notebooks.projects, destination)
          .map((p) => p.name)
          .join(" / ")
      : item.kind === "notebook"
        ? "Top level"
        : "Unfiled";
    setNotice(
      completed.length
        ? `${completed.length} ${item.kind === "notebook" ? "notebook" : completed.length === 1 ? "note" : "notes"} moved to ${name}.`
        : errors.length
          ? "Could not complete the move."
          : "Already in this notebook.",
    );
    setBusy(false);
    working.current = false;
  }
  async function undoMove() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const remaining: Undo[] = [];
    const errors: string[] = [];
    for (const record of undo) {
      try {
        if (record.kind === "notes")
          await moveNote(record.after, record.before.projectId);
        else await moveNotebook(record.after, record.before.parentId ?? null);
      } catch (error) {
        remaining.push(record);
        errors.push(errorMessage(error));
      }
    }
    setUndo(remaining);
    setFailures(errors);
    setNotice(
      remaining.length
        ? "Some changes could not be undone. Your newer changes are preserved."
        : "Change undone.",
    );
    if (remaining.some((record) => record.kind === "notebook"))
      notebooks.reload();
    setBusy(false);
    working.current = false;
  }
  return (
    <Context.Provider
      value={{
        active,
        busy,
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={(args) =>
          pointerWithin({
            ...args,
            pointerCoordinates: args.pointerCoordinates ?? {
              x: args.collisionRect.left + 8,
              y: args.collisionRect.top + 8,
            },
          })
        }
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up. Use arrow keys to choose a notebook, then Space to move. Escape cancels.",
          },
          announcements: {
            onDragStart: () => "Picked up. Choose a notebook. Escape cancels.",
            onDragOver: ({ over }) =>
              over
                ? `Move to ${over.data.current?.name}.`
                : "Choose an available destination.",
            onDragEnd: ({ over }) =>
              over
                ? `Moving to ${over.data.current?.name}.`
                : "Move cancelled.",
            onDragCancel: () => "Move cancelled.",
          },
        }}
        onDragStart={({ active }) => {
          if (!working.current) setActive(active.data.current?.item ?? null);
        }}
        onDragCancel={() => setActive(null)}
        onDragEnd={({ over }) => {
          if (over && active && !working.current)
            void move(active, over.data.current?.projectId ?? null);
          setActive(null);
        }}
      >
        {children}
        {active && (
          <div className="mobile-drop-tray" aria-label="Move destination">
            <span>Drop into a notebook · Escape to cancel</span>
            <div>
              <NotebookDropTarget
                projectId={null}
                name={active.kind === "notebook" ? "Top level" : "Unfiled"}
                root={active.kind === "notebook"}
              />
              {notebookOptions(notebooks.projects).map((option) => (
                <NotebookDropTarget
                  key={option.value}
                  projectId={option.value}
                  name={option.label}
                />
              ))}
            </div>
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="memory-drag-preview">
              <FolderInput size={18} />
              <span>
                <strong>
                  {active.kind === "notebook"
                    ? active.project.name
                    : active.items.length > 1
                      ? `${active.items.length} notes`
                      : memoryTitle(active.items[0])}
                </strong>
                <small>
                  {active.kind === "notebook"
                    ? "Move notebook and its contents"
                    : "Drop into a notebook to move"}
                </small>
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {(notice || busy) && (
        <div className="workspace-notice" role="status">
          <div>
            <span>{busy ? "Moving…" : notice}</span>
            {failures.length > 0 && (
              <ul>
                {failures.map((failure, i) => (
                  <li key={i}>{failure}</li>
                ))}
              </ul>
            )}
          </div>
          {undo.length > 0 && (
            <button disabled={busy} onClick={() => void undoMove()}>
              <Undo2 size={16} />
              Undo
            </button>
          )}
          <button
            disabled={busy}
            aria-label="Dismiss move notification"
            onClick={() => {
              setNotice("");
              setUndo([]);
              setFailures([]);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

export function useNotebookDrop(
  projectId: string | null,
  name: string,
  root = false,
) {
  const id = useId();
  const { active, busy } = useWorkspaceDrag();
  const { projects } = useNotebooks();
  const invalid =
    !active ||
    busy ||
    (active.kind === "notebook"
      ? (!projectId && !root) ||
        (active.project.parentId ?? null) === projectId ||
        notebookPath(projects, projectId).some(
          (p) => p.id === active.project.id,
        )
      : (!projectId && root) ||
        active.items.every((note) => note.projectId === projectId));
  const drop = useDroppable({
    id,
    data: { projectId, name },
    disabled: invalid,
  });
  return { ...drop, invalid, dragging: !!active };
}

export function NotebookDropTarget({
  projectId,
  name,
  root = false,
}: {
  projectId: string | null;
  name: string;
  root?: boolean;
}) {
  const { setNodeRef, isOver, invalid, dragging } = useNotebookDrop(
    projectId,
    name,
    root,
  );
  return (
    <div
      ref={setNodeRef}
      className="notebook-drop-target"
      data-destination={projectId ?? (root ? "root" : "personal")}
      data-drop-active={isOver || undefined}
      data-drop-disabled={(dragging && invalid) || undefined}
    >
      {name}
    </div>
  );
}

export function NoteDragHandle({
  memory,
  disabled = false,
}: {
  memory: Memory;
  disabled?: boolean;
}) {
  const id = useId();
  const { busy } = useWorkspaceDrag();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } =
    useDraggable({
      id,
      data: {
        item: { kind: "notes", items: [memory] } satisfies WorkspaceDragItem,
      },
      disabled: disabled || busy,
    });
  return (
    <span ref={setNodeRef}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled || busy}
        className="drag-handle"
        aria-label={`Move ${memoryTitle(memory)} with drag or keyboard`}
        title={
          disabled
            ? "Save your changes before moving"
            : "Drag to a notebook, or press Space to move"
        }
      >
        <GripVertical size={16} />
      </button>
    </span>
  );
}
