"use client";

import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ChevronRight, Folder, FolderOpen, GripVertical } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import type { Project } from "@/lib/dashboard-api";
import { notebookOrder, notebookPath } from "@/lib/notebooks";
import { useNotebooks } from "./notebooks-provider";
import { IconButton } from "./ui/button";
import {
  useNotebookDrop,
  useWorkspaceDrag,
  type WorkspaceDragItem,
} from "./memory-drag";
import { NotebookPages } from "./notebook-pages";
import { useWorkspaceNavigationState } from "./workspace-navigation-state";

/** Disclosure navigation uses ordinary links/buttons, with full native keyboard access. */
export function NotebookTree({
  projects,
  selectedId,
  query = "",
  actions,
  renderItem,
  defaultExpanded = false,
  showNotes = false,
  notesVisible = true,
  remember = false,
  draggable = true,
}: {
  projects: readonly Project[];
  selectedId?: string | null;
  query?: string;
  actions?: (project: Project) => ReactNode;
  renderItem?: (project: Project) => ReactNode;
  defaultExpanded?: boolean;
  showNotes?: boolean;
  notesVisible?: boolean;
  remember?: boolean;
  draggable?: boolean;
}) {
  const coarse = useSyncExternalStore(
    subscribeCoarse,
    coarsePointer,
    () => false,
  );
  const navigation = useWorkspaceNavigationState();
  const [localExpanded, setLocalExpanded] = useState<Record<string, boolean>>(
    {},
  );
  const [dragExpanded, setDragExpanded] = useState<{
    owner: WorkspaceDragItem | null;
    ids: Record<string, boolean>;
  }>({ owner: null, ids: {} });
  const { active } = useWorkspaceDrag();
  const expanded =
    remember && navigation?.ready ? navigation.state.expanded : localExpanded;
  const setExpanded = (next: Record<string, boolean>) => {
    if (remember && navigation?.ready) navigation.update({ expanded: next });
    else setLocalExpanded(next);
  };
  const sorted = [...projects].sort(notebookOrder);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const paths = new Map(
    projects.map((p) => [p.id, notebookPath(projects, p.id, byId)]),
  );
  const ancestors = new Set(
    (paths.get(selectedId ?? "") ?? []).map((p) => p.id),
  );
  const matching = query.trim()
    ? new Set(
        projects
          .filter((p) =>
            p.name
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .flatMap((p) => paths.get(p.id)!.map((p) => p.id)),
      )
    : null;
  const groups = new Map<string | null, Project[]>();
  for (const p of sorted) {
    if (matching && !matching.has(p.id)) continue;
    const parent = p.parentId && byId.has(p.parentId) ? p.parentId : null;
    const group = groups.get(parent) ?? [];
    group.push(p);
    groups.set(parent, group);
  }
  const children = (parent: string | null) => groups.get(parent) ?? [];
  function branch(parent: string | null, depth = 0): ReactNode {
    if (depth > projects.length) return null;
    return (
      <ul className="notebook-tree-list" data-deep={depth > 4 || undefined}>
        {children(parent).map((project) => {
          const hasChildren = showNotes || children(project.id).length > 0;
          const open =
            matching ||
            (active &&
              dragExpanded.owner === active &&
              dragExpanded.ids[project.id]) ||
            (expanded[project.id] ??
              (defaultExpanded || ancestors.has(project.id)));
          const Icon = hasChildren && open ? FolderOpen : Folder;
          return (
            <NotebookBranch
              key={project.id}
              project={project}
              draggable={draggable}
              coarse={coarse}
              name={paths
                .get(project.id)!
                .map((p) => p.name)
                .join(" / ")}
              current={project.id === selectedId}
              open={!!open}
              hasChildren={hasChildren}
              expand={() =>
                setDragExpanded((value) => ({
                  owner: active,
                  ids: {
                    ...(value.owner === active ? value.ids : {}),
                    [project.id]: true,
                  },
                }))
              }
              disclosure={
                hasChildren ? (
                  <IconButton
                    disabled={remember && !!navigation && !navigation.ready}
                    label={`${open ? "Collapse" : "Expand"} ${project.name}`}
                    aria-expanded={!!open}
                    className="notebook-disclosure"
                    onClick={() =>
                      setExpanded({ ...expanded, [project.id]: !open })
                    }
                  >
                    <ChevronRight size={14} />
                  </IconButton>
                ) : (
                  <span className="notebook-disclosure-spacer" />
                )
              }
              icon={<Icon size={16} strokeWidth={1.6} />}
              row={
                <>
                  {renderItem ? (
                    renderItem(project)
                  ) : (
                    <Link
                      className="notebook-tree-link"
                      href={`/app/projects/${project.id}`}
                      aria-current={
                        project.id === selectedId ? "page" : undefined
                      }
                      title={paths
                        .get(project.id)!
                        .map((p) => p.name)
                        .join(" / ")}
                    >
                      <span>{project.name}</span>
                    </Link>
                  )}
                  {actions && (
                    <div className="notebook-tree-actions">
                      {actions(project)}
                    </div>
                  )}
                </>
              }
            >
              {hasChildren && open && (
                <>
                  {branch(project.id, depth + 1)}
                  {showNotes && notesVisible && (
                    <NotebookPages projectId={project.id} />
                  )}
                </>
              )}
            </NotebookBranch>
          );
        })}
      </ul>
    );
  }
  return <div className="notebook-tree">{branch(null)}</div>;
}

type NotebookBranchProps = {
  project: Project;
  draggable: boolean;
  coarse: boolean;
  name: string;
  current: boolean;
  open: boolean;
  hasChildren: boolean;
  expand: () => void;
  disclosure: ReactNode;
  icon: ReactNode;
  row: ReactNode;
  children: ReactNode;
};

function NotebookBranch(props: NotebookBranchProps) {
  if (props.draggable) return <DraggableNotebookBranch {...props} />;
  // The tap/keyboard organizer is a plain disclosure list, not 1,500 disabled
  // drag/drop registrations for a 500-notebook catalog.
  return (
    <li className="notebook-branch">
      <div
        className="notebook-tree-row"
        data-current={props.current || undefined}
      >
        {props.disclosure}
        <span
          className="drag-handle notebook-drag-handle"
          data-touch-organize
          aria-hidden="true"
          style={{ cursor: "default", color: "var(--color-muted)" }}
        >
          <span className="notebook-folder-icon">{props.icon}</span>
        </span>
        {props.row}
      </div>
      {props.children}
    </li>
  );
}

function DraggableNotebookBranch({
  project,
  draggable,
  coarse,
  name,
  current,
  open,
  hasChildren,
  expand,
  disclosure,
  icon,
  row,
  children,
}: NotebookBranchProps) {
  const id = useId();
  const notebooks = useNotebooks();
  const { busy, active, keyboard } = useWorkspaceDrag();
  const {
    setNodeRef: setBeforeRef,
    isOver: beforeOver,
    invalid: beforeInvalid,
  } = useNotebookDrop(
    project.parentId ?? null,
    `Before ${project.name}`,
    !project.parentId,
    { beforeId: project.id },
  );
  const {
    setNodeRef: setAfterRef,
    isOver: afterOver,
    invalid: afterInvalid,
  } = useNotebookDrop(
    project.parentId ?? null,
    `After ${project.name}`,
    !project.parentId,
    { afterId: project.id },
  );
  const {
    setNodeRef: setDropRef,
    isOver,
    dragging,
    invalid,
  } = useNotebookDrop(project.id, name);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } =
    useDraggable({
      id,
      data: { item: { kind: "notebook", project } satisfies WorkspaceDragItem },
      disabled: busy || !draggable || coarse,
    });
  useEffect(() => {
    if (!isOver || open || !hasChildren) return;
    const timer = setTimeout(expand, 550);
    return () => clearTimeout(timer);
  }, [isOver, open, hasChildren, expand]);
  return (
    <li
      ref={setNodeRef}
      data-dragging={isDragging || undefined}
      className="notebook-branch"
    >
      {draggable && !coarse && !keyboard && active?.kind === "notebook" && (
        <div
          ref={setBeforeRef}
          className="notebook-insertion before"
          data-drop-active={beforeOver || undefined}
          data-drop-disabled={beforeInvalid || undefined}
          aria-hidden="true"
        />
      )}
      <div
        ref={setDropRef}
        className="notebook-tree-row"
        data-current={current || undefined}
        data-destination={project.id}
        data-drop-active={isOver || undefined}
        data-drop-disabled={(dragging && invalid) || undefined}
      >
        {disclosure}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...(draggable && !coarse ? attributes : {})}
          {...(draggable && !coarse ? listeners : {})}
          className="drag-handle notebook-drag-handle"
          data-touch-organize={coarse || !draggable || undefined}
          disabled={busy || !draggable}
          aria-hidden={!draggable || undefined}
          aria-label={
            coarse || !draggable
              ? `Organize ${project.name}`
              : `Move notebook ${project.name} with drag or keyboard`
          }
          title={
            coarse || !draggable
              ? "Organize notebook"
              : "Drag to nest, or press Space to move"
          }
          onClick={() => {
            if (coarse && draggable) notebooks.openOrganizer(project.id);
          }}
        >
          <span className="notebook-folder-icon" aria-hidden="true">
            {icon}
          </span>
          <GripVertical
            className="notebook-grip-icon"
            size={14}
            aria-hidden="true"
          />
        </button>
        {row}
      </div>
      {draggable && !coarse && !keyboard && active?.kind === "notebook" && (
        <div
          ref={setAfterRef}
          className="notebook-insertion after"
          data-drop-active={afterOver || undefined}
          data-drop-disabled={afterInvalid || undefined}
          aria-hidden="true"
        />
      )}
      {children}
    </li>
  );
}

const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;
function subscribeCoarse(update: () => void) {
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
