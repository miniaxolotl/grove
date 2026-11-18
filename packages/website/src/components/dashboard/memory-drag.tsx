"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  PointerSensor,
  KeyboardCode,
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
import { useWorkspaceApi, useWorkspaceCache } from "./workspace-cache";
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

type NotebookDestination = {
  kind: "notebook";
  projectId: string | null;
  root: boolean;
  name: string;
  beforeId?: string;
  afterId?: string;
};
type Destination = NotebookDestination | { kind: "cancel"; name: string };
function describeDestination(destination: NotebookDestination) {
  if (destination.beforeId || destination.afterId)
    return destination.name.replace(/^(Before|After)/, (word) =>
      word.toLowerCase(),
    );
  return `${destination.projectId === null ? "to" : "into"} ${destination.name}`;
}
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
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function subscribeReducedMotion(update: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
function pickupFeedback(activatorEvent: Event) {
  if (
    activatorEvent.type !== "touchstart" &&
    !(
      activatorEvent instanceof PointerEvent &&
      activatorEvent.pointerType === "touch"
    )
  )
    return;
  // Confirm the hold lifted the item; ignored where unsupported.
  if ("vibrate" in navigator) navigator.vibrate(10);
}
const previewOffset: Modifier = ({
  transform,
  activatorEvent,
  overlayNodeRect,
  windowRect,
}) => {
  const touch = activatorEvent?.type === "touchstart";
  const point =
    touch && "touches" in activatorEvent
      ? (activatorEvent as TouchEvent).touches[0]
      : activatorEvent && "clientX" in activatorEvent
        ? (activatorEvent as MouseEvent)
        : null;
  if (!point) return transform; // Keyboard keeps its measured row origin.

  // Pointer overlays have a viewport origin, independent of the source row.
  // Only the preview moves here: collision and auto-scroll use the sensor point.
  const direct =
    touch || (activatorEvent as PointerEvent | null)?.pointerType === "pen";
  const x = point.clientX + transform.x;
  const y = point.clientY + transform.y;
  const width = overlayNodeRect?.width ?? 0;
  const height = overlayNodeRect?.height ?? 0;
  const inset = 8;
  const gap = direct ? 18 : 14;
  const viewportWidth = windowRect?.width ?? window.innerWidth;
  const viewportHeight = windowRect?.height ?? window.innerHeight;
  const clamp = (value: number, end: number) =>
    Math.max(inset, Math.min(value, end - inset));
  const above = y - height - gap;
  const below = y + gap;
  const right = x + gap;
  const preferAbove = direct
    ? above >= inset
    : below + height > viewportHeight - inset;
  return {
    ...transform,
    x: clamp(
      direct
        ? x - width / 2
        : right + width <= viewportWidth - inset
          ? right
          : x - width - gap,
      viewportWidth - width,
    ),
    y: clamp(preferAbove ? above : below, viewportHeight - height),
  };
};
function releasePoint(activator: Event, event: Event) {
  if ("touches" in activator && "changedTouches" in event) {
    const id = (activator as TouchEvent).touches[0]?.identifier;
    return Array.from((event as TouchEvent).changedTouches).find(
      (touch) => touch.identifier === id,
    );
  }
  if (activator instanceof PointerEvent && activator.pointerType === "pen") {
    return event instanceof PointerEvent &&
      event.pointerId === activator.pointerId
      ? event
      : undefined;
  }
  return activator.type === "mousedown" &&
    event.type === "mouseup" &&
    event instanceof MouseEvent &&
    event.button === 0
    ? event
    : undefined;
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
  const cache = useWorkspaceCache();
  const notebooks = useNotebooks();
  const path = usePathname();
  const origin = useRef<{ path: string; source: Element | null } | null>(null);
  const [active, setActive] = useState<WorkspaceDragItem | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const pickingUp = useRef(false);
  const activator = useRef<Event | null>(null);
  const releasedAt = useRef<Element | null>(null);
  const [notice, setNotice] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [undo, setUndo] = useState<Undo[]>([]);
  const operations = useRef(new Map<string, string>());
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotion,
    () => false,
  );
  const dropAnimation =
    reduced || keyboard
      ? null
      : {
          duration: 160,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          sideEffects: undefined,
        };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(PenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: destinationCoordinates,
      keyboardCodes: {
        start: [KeyboardCode.Space, KeyboardCode.Enter],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
        cancel: [KeyboardCode.Esc, KeyboardCode.Tab],
      },
    }),
  );
  useEffect(() => {
    const interrupt = () => {
      if (pickingUp.current) cancelDrag();
    };
    const release = (event: Event) => {
      if (!pickingUp.current || !activator.current) return;
      const point = releasePoint(activator.current, event);
      if (point)
        releasedAt.current = document.elementFromPoint(
          point.clientX,
          point.clientY,
        );
    };
    // A second contact interrupts both long-press activation and an active drag.
    document.addEventListener("pointerdown", interrupt, true);
    // dnd-kit uses the last move for `over`; capture the terminal native sample
    // before its sensor ends so a fast release cannot commit a stale highlight.
    document.addEventListener("mouseup", release, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("touchend", release, true);
    window.addEventListener("blur", interrupt);
    return () => {
      document.removeEventListener("pointerdown", interrupt, true);
      document.removeEventListener("mouseup", release, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("touchend", release, true);
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
    const moved = item.items
      .filter((note) => note.projectId !== destination)
      .slice(0, 50);
    // Instant patch first: the rows jump to the destination notebook immediately.
    cache.applyNoteRecords(
      new Map(
        moved.map((note) => [
          note.id,
          { ...note, projectId: destination, version: note.version + 1 },
        ]),
      ),
    );
    const completed: Undo[] = [];
    const errors: string[] = [];
    for (const before of moved) {
      try {
        completed.push({
          kind: "notes",
          before,
          after: await moveNote(before, destination),
        });
      } catch (error) {
        cache.restoreNoteRecords(new Map([[before.id, before]]));
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
          // The browser hit test accounts for clipping and stacking (including
          // the fixed tray); a covered row is not a destination.
          const hit = document.elementFromPoint(point.x, point.y);
          const targets = hit
            ? args.droppableContainers.filter(({ node }) =>
                node.current?.contains(hit),
              )
            : [];
          return pointerWithin({
            ...args,
            pointerCoordinates: point,
            droppableContainers: targets,
          }).sort((a, b) => {
            const placement = (collision: typeof a) => {
              const d =
                collision.data?.droppableContainer.data.current?.destination;
              return Number(!!(d?.beforeId || d?.afterId));
            };
            return placement(b) - placement(a);
          });
        }}
        cancelDrop={({ over, collisions, activatorEvent }) => {
          const destination: Destination | undefined =
            over?.data.current?.destination;
          if (
            !active ||
            !over ||
            destination?.kind !== "notebook" ||
            working.current ||
            notebooks.organizationLocked ||
            origin.current?.path !== path ||
            !origin.current.source?.isConnected ||
            !validDestination(active, destination, notebooks.projects)
          )
            return true;
          if (activatorEvent.type === "keydown") return false;
          const shown: HTMLElement | null | undefined =
            collisions?.[0]?.id === over.id
              ? collisions[0].data?.droppableContainer.node.current
              : null;
          return (
            !shown ||
            !shown.hasAttribute("data-drop-active") ||
            !shown.isConnected ||
            !releasedAt.current ||
            !shown.contains(releasedAt.current)
          );
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up. Use arrow keys to choose a notebook, then Space to move. Escape or Tab cancels.",
          },
          announcements: {
            onDragStart: () => "Picked up. Choose a notebook. Escape cancels.",
            onDragOver: ({ over }) => {
              const destination: Destination | undefined =
                over?.data.current?.destination;
              return destination?.kind === "cancel"
                ? "Cancel move."
                : destination
                  ? `Move ${describeDestination(destination)}.`
                  : "Choose an available destination.";
            },
            onDragEnd: ({ over }) => {
              const destination: Destination | undefined =
                over?.data.current?.destination;
              return destination?.kind === "notebook"
                ? `Moving ${describeDestination(destination)}.`
                : "Move cancelled.";
            },
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
          activator.current = activatorEvent;
          releasedAt.current = null;
          setKeyboard(activatorEvent.type === "keydown");
          pickingUp.current = true;
          pickupFeedback(activatorEvent);
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
          activator.current = null;
          releasedAt.current = null;
          setActive(null);
        }}
        onDragEnd={({ over }) => {
          pickingUp.current = false;
          activator.current = null;
          releasedAt.current = null;
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
          dropAnimation={dropAnimation}
          modifiers={[previewOffset]}
          transition="none"
          style={{
            width: "max-content",
            height: "auto",
            pointerEvents: "none",
            ...(keyboard ? {} : { top: 0, left: 0 }),
          }}
        >
          {active && (
            <div
              className="memory-drag-preview"
              aria-hidden="true"
              // Keyboard uses the focused grip and highlighted row, not a chip
              // over the destination. Keep the geometry dnd-kit measures.
              data-keyboard={keyboard || undefined}
            >
              {active.kind === "notebook" ? (
                <FolderInput size={16} />
              ) : active.items.length > 1 ? (
                <Files size={16} />
              ) : (
                <FileText size={16} />
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
