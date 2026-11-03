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
import {
  FileText,
  Files,
  FolderInput,
  GripVertical,
  Undo2,
  X,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { useWorkspaceApi } from "./workspace-cache";
import { memoryTitle, moveMemoryInput } from "@/lib/memory-display";
import { notebookPath, notebookOptions } from "@/lib/notebooks";
import { useNotebooks } from "./notebooks-provider";
import { WorkspaceNotice } from "./toasts";

export type WorkspaceDragItem =
  | { kind: "notes"; items: Memory[] }
  | { kind: "notebook"; project: Project };
type Undo = { kind: "notes"; before: Memory; after: Memory };
const Context = createContext<{
  active: WorkspaceDragItem | null;
  busy: boolean;
  keyboard: boolean;
}>({ active: null, busy: false, keyboard: false });
export const useWorkspaceDrag = () => useContext(Context);

type Destination =
  | {
      kind: "notebook";
      projectId: string | null;
      root: boolean;
      name: string;
      beforeId?: string;
      afterId?: string;
    }
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
        ((item.project.parentId ?? null) !== destination.projectId ||
          !!destination.beforeId ||
          !!destination.afterId) &&
        destination.beforeId !== item.project.id &&
        destination.afterId !== item.project.id &&
        !notebookPath(projects, destination.projectId).some(
          (p) => p.id === item.project.id,
        )
    : !destination.beforeId &&
        !destination.afterId &&
        (destination.projectId !== null || !destination.root) &&
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
const previewOffset: Modifier = ({
  transform,
  activatorEvent,
  activeNodeRect,
  overlayNodeRect,
  windowRect,
}) => {
  if (!activeNodeRect || !overlayNodeRect || !windowRect) return transform;
  const touch =
    activatorEvent?.type === "touchstart" ||
    (activatorEvent as PointerEvent | null)?.pointerType === "pen";
  const point =
    activatorEvent && "clientX" in activatorEvent
      ? (activatorEvent as MouseEvent)
      : null;
  // Anchor every source (a whole row or a small sidebar icon) beside the pointer.
  // Touch previews sit above the finger so the destination remains visible.
  const x =
    transform.x + (point ? point.clientX - activeNodeRect.left + 14 : 0);
  const y =
    transform.y +
    (touch ? -64 : point ? point.clientY - activeNodeRect.top + 14 : 0);
  return {
    ...transform,
    x: Math.max(
      8 - activeNodeRect.left,
      Math.min(
        x,
        windowRect.width - overlayNodeRect.width - activeNodeRect.left - 8,
      ),
    ),
    y: Math.max(
      8 - activeNodeRect.top,
      Math.min(
        y,
        windowRect.height - overlayNodeRect.height - activeNodeRect.top - 8,
      ),
    ),
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
  const api = useWorkspaceApi();
  const notebooks = useNotebooks();
  const path = usePathname();
  const origin = useRef<{ path: string; source: Element | null } | null>(null);
  const [active, setActive] = useState<WorkspaceDragItem | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const pickingUp = useRef(false);
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
  async function move(
    item: WorkspaceDragItem,
    destination: string | null,
    placement: { beforeId?: string; afterId?: string } = {},
  ) {
    if (item.kind === "notebook") {
      await notebooks.organize(item.project, {
        parentId: destination,
        ...placement,
      });
      return;
    }
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    setFailures([]);
    setUndo([]);
    const completed: Undo[] = [];
    const errors: string[] = [];
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
    setUndo(completed);
    setFailures(errors);
    const name = destination
      ? notebookPath(notebooks.projects, destination)
          .map((p) => p.name)
          .join(" / ")
      : "Unfiled";
    setNotice(
      completed.length
        ? `${completed.length} ${completed.length === 1 ? "note" : "notes"} moved to ${name}.`
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
        await moveNote(record.after, record.before.projectId);
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
    setBusy(false);
    working.current = false;
  }
  return (
    <Context.Provider
      value={{
        active,
        busy: busy || notebooks.organizationLocked,
        keyboard,
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const point = args.pointerCoordinates ?? {
            x: args.collisionRect.left + 8,
            y: args.collisionRect.top + 8,
          };
          const targets = args.droppableContainers.filter((target) =>
            insideScrollClip(target.node.current, point),
          );
          return pointerWithin({
            ...args,
            pointerCoordinates: point,
            droppableContainers: targets,
          }).sort((a, b) => {
            const placement = (id: typeof a.id) => {
              const d = targets.find((target) => target.id === id)?.data.current
                ?.destination;
              return Number(!!(d?.beforeId || d?.afterId));
            };
            return placement(b.id) - placement(a.id);
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
          setKeyboard(activatorEvent.type === "keydown");
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
            void move(active, destination.projectId, {
              ...(destination.beforeId
                ? { beforeId: destination.beforeId }
                : {}),
              ...(destination.afterId ? { afterId: destination.afterId } : {}),
            });
          setActive(null);
        }}
      >
        {children}
        {active && (
          <div className="workspace-drop-surface">
            <div className="mobile-drop-tray" aria-label="Move destination">
              <span>Move to</span>
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
            <CancelDropTarget />
          </div>
        )}
        <DragOverlay
          dropAnimation={null}
          modifiers={[previewOffset]}
          style={{ width: "max-content" }}
        >
          {active && (
            <div className="memory-drag-preview">
              {active.kind === "notebook" ? (
                <FolderInput size={18} />
              ) : active.items.length > 1 ? (
                <Files size={18} />
              ) : (
                <FileText size={18} />
              )}
              <strong>
                {active.kind === "notebook"
                  ? active.project.name
                  : active.items.length > 1
                    ? `${active.items.length} notes`
                    : memoryTitle(active.items[0])}
              </strong>
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
  placement?: { beforeId?: string; afterId?: string },
) {
  const id = useId();
  const { active, busy, keyboard } = useWorkspaceDrag();
  const { projects } = useNotebooks();
  const invalid =
    !active ||
    busy ||
    (!!placement && (keyboard || active?.kind !== "notebook")) ||
    !validDestination(
      active,
      { kind: "notebook", projectId, root, name, ...placement },
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
        ...placement,
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
  icon,
}: {
  memory: Memory;
  disabled?: boolean;
  icon?: ReactNode;
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
    <span ref={setNodeRef} className="note-drag-source">
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled || busy}
        className={`drag-handle${icon ? " note-icon-handle" : ""}`}
        aria-label={`Move ${memoryTitle(memory)} with drag or keyboard`}
        title={
          disabled
            ? "Save your changes before moving"
            : "Drag to a notebook, or press Space to move"
        }
      >
        {icon && (
          <span className="note-file-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <GripVertical className="note-grip-icon" size={14} aria-hidden="true" />
      </button>
    </span>
  );
}
