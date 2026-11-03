"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Plus, Inbox, Folder, FolderCog, ChevronDown } from "lucide-react";
import { useNotebooks, useCurrentNotebook } from "./notebooks-provider";
import { NotebookTree } from "./notebook-tree";
import { NotebookDialog, type NotebookAction } from "./notebook-dialog";
import { IconButton } from "./ui/button";
import {
  NotebookDropTarget,
  useNotebookDrop,
  useWorkspaceDrag,
} from "./memory-drag";
import { ActionMenu } from "./ui/action-menu";
import { ShareDialog } from "./share-dialog";
import { NotebookActions } from "./notebook-actions";
import { useWorkspaceNavigationState } from "./workspace-navigation-state";
const desktop = () => matchMedia("(min-width: 1024px)").matches;
const subscribeDesktop = (callback: () => void) => {
  const media = matchMedia("(min-width: 1024px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};

export function NotebookExplorer() {
  const { projects, loading, error, reload, openOrganizer } = useNotebooks();
  const path = usePathname();
  const currentNotebook = useCurrentNotebook();
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const open = openPath === path;
  const wide = useSyncExternalStore(subscribeDesktop, desktop, () => false);
  const id = useId();
  const explorer = useRef<HTMLElement>(null);
  const navigation = useWorkspaceNavigationState();
  const savedScroll = useEffectEvent(
    (mode: "desktop" | "mobile") => navigation?.state.scroll[mode] ?? 0,
  );
  const rememberScroll = useEffectEvent(
    (mode: "desktop" | "mobile", top: number) => {
      if (navigation?.ready)
        navigation.update({
          scroll: { ...navigation.state.scroll, [mode]: top },
        });
    },
  );
  const ready = navigation?.ready ?? false;
  const prune = useEffectEvent(() => {
    if (!navigation?.ready || loading || error) return;
    const known = new Set(projects.map((project) => project.id));
    const expanded = Object.fromEntries(
      Object.entries(navigation.state.expanded).filter(([id]) => known.has(id)),
    );
    if (
      Object.keys(expanded).length !==
      Object.keys(navigation.state.expanded).length
    )
      navigation.update({ expanded });
  });
  useEffect(() => {
    const frame = requestAnimationFrame(() => prune());
    return () => cancelAnimationFrame(frame);
  }, [ready, projects, loading, error]);
  useEffect(() => {
    if (!ready || loading || error || (!wide && !open)) return;
    const element = explorer.current;
    if (!element) return;
    const mode = wide ? "desktop" : "mobile";
    const target = savedScroll(mode);
    let restoring = true;
    let timer: ReturnType<typeof setTimeout>;
    const restore = () => {
      if (restoring) element.scrollTop = target;
    };
    const stop = () => {
      restoring = false;
    };
    const scroll = () => {
      if (restoring) return;
      clearTimeout(timer);
      timer = setTimeout(() => rememberScroll(mode, element.scrollTop), 150);
    };
    restore();
    const observer = new ResizeObserver(restore);
    for (const child of element.children) observer.observe(child);
    const deadline = setTimeout(stop, 5000);
    element.addEventListener("wheel", stop, { passive: true });
    element.addEventListener("touchstart", stop, { passive: true });
    element.addEventListener("pointerdown", stop);
    element.addEventListener("keydown", stop);
    element.addEventListener("scroll", scroll, { passive: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(deadline);
      element.removeEventListener("wheel", stop);
      element.removeEventListener("touchstart", stop);
      element.removeEventListener("pointerdown", stop);
      element.removeEventListener("keydown", stop);
      element.removeEventListener("scroll", scroll);
    };
  }, [ready, loading, error, wide, open]);
  const { active } = useWorkspaceDrag();
  const { setNodeRef, isOver } = useNotebookDrop(null, "Unfiled");
  return (
    <div className="notebook-browser">
      <button
        className="notebook-browser-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpenPath(open ? null : path)}
      >
        <Folder size={16} /> Notebooks <ChevronDown size={14} />
      </button>
      <section
        ref={explorer}
        id={id}
        className="notebook-explorer"
        data-mobile-open={open || undefined}
        aria-label="Your notebooks"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpenPath(null);
        }}
      >
        <div className="notebook-explorer-heading">
          <span>Notebooks</span>
          <button
            type="button"
            className="text-button notebook-organize-entry"
            onClick={() => openOrganizer()}
          >
            Organize
          </button>
          <Link
            href="/app/projects"
            className="app-icon notebook-manage"
            aria-label="Manage notebooks"
            title="Manage notebooks"
          >
            <FolderCog size={16} aria-hidden="true" />
          </Link>
          <IconButton
            label="Create notebook"
            onClick={() => setAction({ mode: "create" })}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        <Link
          ref={setNodeRef}
          className="notebook-personal"
          href="/app?notebook=personal"
          aria-current={currentNotebook === null ? "page" : undefined}
          data-destination="personal"
          data-drop-active={isOver || undefined}
        >
          <Inbox size={15} />
          Unfiled
        </Link>
        {active?.kind === "notebook" && (
          <NotebookDropTarget projectId={null} name="Top level" root />
        )}
        {loading ? (
          <p className="notebook-tree-message">Opening notebooks…</p>
        ) : error ? (
          <button className="text-button" onClick={reload}>
            Retry notebooks
          </button>
        ) : projects.length ? (
          <NotebookTree
            remember
            showNotes
            notesVisible={wide || open}
            projects={projects}
            selectedId={currentNotebook}
            actions={(project) => (
              <ActionMenu label={`Notebook actions for ${project.name}`}>
                <NotebookActions
                  project={project}
                  onAction={setAction}
                  onShare={() => setSharing(project.id)}
                />
              </ActionMenu>
            )}
          />
        ) : (
          <p className="notebook-tree-message">
            <button
              className="text-button"
              onClick={() => setAction({ mode: "create" })}
            >
              Create a notebook
            </button>
          </p>
        )}
        {action && (
          <NotebookDialog action={action} close={() => setAction(null)} />
        )}
        {sharing && (
          <ShareDialog
            target={{ kind: "notebook", id: sharing }}
            close={() => setSharing(null)}
          />
        )}
      </section>
    </div>
  );
}
