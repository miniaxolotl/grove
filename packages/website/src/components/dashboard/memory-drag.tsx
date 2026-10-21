"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  pointerWithin,
  type KeyboardCoordinateGetter,
  type Modifier,
} from "@dnd-kit/core";
import { FolderInput, GripVertical, Undo2, X } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { memoryTitle, moveMemoryInput } from "@/lib/memory-display";
import { notebookPath, notebookOptions } from "@/lib/notebooks";
import { useNotebooks } from "./notebooks-provider";
import { WorkspaceNotice } from "./toasts";

export type WorkspaceDragItem =
  | { kind: "notes"; items: Memory[] }
  | { kind: "notebook"; project: Project };
type Undo =
  | { kind: "notes"; before: Memory; after: Memory }
  | { kind: "notebook"; before: Project; after: Project };
const Context = createContext<{
  active: WorkspaceDragItem | null;
  busy: boolean;
  revision: number;
  refresh: () => void;
}>({ active: null, busy: false, revision: 0, refresh: () => {} });
export const useWorkspaceDrag = () => useContext(Context);

type Destination =
  | { kind: "notebook"; projectId: string | null; root: boolean; name: string }
  | { kind: "cancel"; name: string };
function validDestination(
  item: WorkspaceDragItem,
  destination: Destination,
  projects: Project[],
) {
  if (
    destination.kind !== "notebook" ||
    (destination.projectId !== null &&
      !projects.some((p) => p.id === destination.projectId))
  )
    return false;
  return item.kind === "notebook"
    ? (destination.projectId !== null || destination.root) &&
        (item.project.parentId ?? null) !== destination.projectId &&
        !notebookPath(projects, destination.projectId).some(
          (p) => p.id === item.project.id,
        )
    : (destination.projectId !== null || !destination.root) &&
        item.items.some((note) => note.projectId !== destination.projectId);
}
// Mouse/touch keep their tuned activation. Pens use their own primary-pointer path.
class PenSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators =
    PointerSensor.activators.map((activator) => ({
      ...activator,
      handler: (event, options) =>
        event.nativeEvent.pointerType === "pen" &&
        activator.handler(event, options),
    }));
}
function cancelDrag() {
  // dnd-kit sensors share Escape cancellation; use it for the visible cancel control.
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
    }),
  );
}
const fingerOffset: Modifier = ({
  transform,
  activatorEvent,
  activeNodeRect,
  overlayNodeRect,
  windowRect,
}) => {
  if (
    activatorEvent?.type !== "touchstart" &&
    (activatorEvent as PointerEvent | null)?.pointerType !== "pen"
  )
    return transform;
  return {
    ...transform,
    y: transform.y - 64,
    x:
      activeNodeRect && overlayNodeRect && windowRect
        ? Math.max(
            8 - activeNodeRect.left,
            Math.min(
              transform.x,
              windowRect.width -
                overlayNodeRect.width -
                activeNodeRect.left -
                8,
            ),
          )
        : transform.x,
  };
};
function insideScrollClip(
  node: HTMLElement | null,
  point: { x: number; y: number },
) {
  for (
    let parent = node?.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const rect = parent.getBoundingClientRect();
    if (
      /(auto|scroll|hidden|clip)/.test(style.overflowY) &&
      (point.y < rect.top || point.y > rect.bottom)
    )
      return false;
    if (
      /(auto|scroll|hidden|clip)/.test(style.overflowX) &&
      (point.x < rect.left || point.x > rect.right)
    )
      return false;
  }
  return true;
}

const destinationCoordinates: KeyboardCoordinateGetter = (
  event,
  { context },
) => {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.code))
    return;
  event.preventDefault();
  const seen = new Set<string>();
  const targets = context.droppableContainers
    .getEnabled()
    .filter((target) => target.node.current?.getClientRects().length)
    .sort((a, b) =>
      a.node.current!.compareDocumentPosition(b.node.current!) &
      Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    )
    .filter((target) => {
      const destination: Destination | undefined =
        target.data.current?.destination;
      if (!destination) return false;
      const key =
        destination.kind === "cancel"
          ? "cancel"
          : `${destination.projectId}:${destination.root}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!targets.length) return;
  const current = targets.findIndex((target) => target.id === context.over?.id);
  const step = event.code === "ArrowUp" || event.code === "ArrowLeft" ? -1 : 1;
  const next =
    targets[
      current < 0
        ? step > 0
          ? 0
          : targets.length - 1
        : (current + step + targets.length) % targets.length
    ];
  const node = next.node.current!;
  node.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
  const rect = node.getBoundingClientRect();
  return { x: rect.left + 4, y: rect.top + 4 };
};

/** One drag surface spans navigation, notes and notebook organization. */
export function WorkspaceDrag({ children }: { children: ReactNode }) {
  const notebooks = useNotebooks();
  const path = usePathname();
  const origin = useRef<{ path: string; source: Element | null } | null>(null);
  const [active, setActive] = useState<WorkspaceDragItem | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const pickingUp = useRef(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [undo, setUndo] = useState<Undo[]>([]);
  const operations = useRef(new Map<string, string>());
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(PenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: destinationCoordinates }),
  );
  useEffect(() => {
    const interrupt = () => {
      if (pickingUp.current) cancelDrag();
    };
    // A second contact interrupts both long-press activation and an active drag.
    document.addEventListener("pointerdown", interrupt, true);
    window.addEventListener("blur", interrupt);
    return () => {
      document.removeEventListener("pointerdown", interrupt, true);
      window.removeEventListener("blur", interrupt);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    if (origin.current?.path !== path) {
      cancelDrag();
      return;
    }
    const checkSource = () => {
      if (!origin.current?.source?.isConnected) cancelDrag();
    };
    const observer = new MutationObserver(checkSource);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, path]);
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
    notebooks.saved(saved);
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
    setRevision((value) => value + 1);
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
    setRevision((value) => value + 1);
    setBusy(false);
    working.current = false;
  }
  return (
    <Context.Provider
      value={{
        active,
        busy,
        revision,
        refresh: () => setRevision((value) => value + 1),
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const point = args.pointerCoordinates ?? {
            x: args.collisionRect.left + 8,
            y: args.collisionRect.top + 8,
          };
          return pointerWithin({
            ...args,
            pointerCoordinates: point,
            droppableContainers: args.droppableContainers.filter((target) =>
              insideScrollClip(target.node.current, point),
            ),
          });
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up. Use arrow keys to choose a notebook, then Space to move. Escape cancels.",
          },
          announcements: {
            onDragStart: () => "Picked up. Choose a notebook. Escape cancels.",
            onDragOver: ({ over }) =>
              over?.data.current?.destination?.kind === "cancel"
                ? "Release to cancel the move."
                : over
                  ? `Move to ${over.data.current?.name}.`
                  : "Choose an available destination.",
            onDragEnd: ({ over }) =>
              over?.data.current?.destination?.kind === "notebook"
                ? `Moving to ${over.data.current?.name}.`
                : "Move cancelled.",
            onDragCancel: () => "Move cancelled.",
          },
        }}
        onDragPending={() => {
          pickingUp.current = true;
        }}
        onDragAbort={() => {
          pickingUp.current = false;
        }}
        onDragStart={({ active, activatorEvent }) => {
          pickingUp.current = true;
          if (!working.current) {
            origin.current = {
              path,
              source:
                activatorEvent.target instanceof Element
                  ? activatorEvent.target
                  : null,
            };
            setActive(active.data.current?.item ?? null);
          }
        }}
        onDragCancel={() => {
          pickingUp.current = false;
          setActive(null);
        }}
        onDragEnd={({ over }) => {
          pickingUp.current = false;
          const destination: Destination | undefined =
            over?.data.current?.destination;
          if (
            active &&
            destination?.kind === "notebook" &&
            !working.current &&
            origin.current?.path === path &&
            origin.current.source?.isConnected &&
            validDestination(active, destination, notebooks.projects)
          )
            void move(active, destination.projectId);
          setActive(null);
        }}
      >
        {children}
        {active && (
          <div className="mobile-drop-tray" aria-label="Move destination">
            <span>Drop into a notebook</span>
            <div className="mobile-drop-destinations">
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
        {active && <CancelDropTarget />}
        <DragOverlay dropAnimation={null} modifiers={[fingerOffset]}>
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
        <WorkspaceNotice>
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
        </WorkspaceNotice>
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
    !validDestination(
      active,
      { kind: "notebook", projectId, root, name },
      projects,
    );
  const drop = useDroppable({
    id,
    data: {
      name,
      destination: {
        kind: "notebook",
        projectId,
        root,
        name,
      } satisfies Destination,
    },
    disabled: invalid,
  });
  return { ...drop, invalid, dragging: !!active };
}

function CancelDropTarget() {
  const id = useId();
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      destination: {
        kind: "cancel",
        name: "Cancel move",
      } satisfies Destination,
    },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className="drag-cancel-target"
      data-drop-active={isOver || undefined}
      onClick={cancelDrag}
    >
      <X size={16} /> Drop here to cancel <kbd>Esc</kbd>
    </button>
  );
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
