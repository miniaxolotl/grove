"use client";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  PanelRight,
  Focus,
  Check,
  Save,
  Download,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import {
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import { MarkdownEditor } from "./markdown-editor";
import { uploadMedia } from "@/lib/media-upload";
import { useDialogBusy } from "./dialog";
import { Button } from "./ui/button";
import { ActionMenu } from "./ui/action-menu";
import { InspectorDialog } from "./ui/inspector-dialog";
import { isActiveSurface } from "@/lib/workspace-keyboard";
import { RevisionCompare } from "./revision-compare";
import { useNoteDrafts, useDraftHeld, type NoteValues } from "./note-drafts";
import { NoteDeleteDialog } from "./note-delete-dialog";
import { CommandMenuButton } from "./workspace-commands";
import { useNoteExport } from "./note-export";
import { Select } from "./ui/select";
import { NotebookSelect } from "./notebook-select";
import { NotebookBreadcrumbs } from "./notebook-breadcrumbs";
import { NotebookDialog } from "./notebook-dialog";
import { useWorkspaceApi } from "./workspace-cache";
import { useSetCurrentNotebook } from "./notebooks-provider";
import { useWorkspaceCommands } from "./workspace-commands";
import { commandDefinitions, workspaceCommand } from "@/lib/workspace-commands";
import {
  matchesShortcut,
  shortcuts,
  shortcutHint,
} from "@/lib/workspace-shortcuts";

const saveOwners = new WeakMap<Promise<Memory>, object>();

function PropertiesPanel({
  overlay,
  open,
  close,
  children,
}: {
  overlay: boolean;
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const fields = <div className="note-editor-properties">{children}</div>;
  return overlay
    ? open && (
        <InspectorDialog title="Note properties" close={close}>
          {fields}
        </InspectorDialog>
      )
    : fields;
}

export function MemoryEditor({
  memory,
  projects,
  projectId: defaultProject = null,
  initialKind = "fact",
  initialContent = "",
  guidance,
  personal = false,
  fullPage = false,
  draftKey,
  initialPreview = false,
  workspace = false,
  toolbar,
  details,
  children,
  onLockChange,
  deleteRequested = false,
  cancelDelete,
  onDeleted,
  done,
  cancel,
}: {
  memory?: Memory;
  projects: Project[];
  projectId?: string | null;
  initialKind?: Memory["kind"];
  initialContent?: string;
  guidance?: string;
  personal?: boolean;
  fullPage?: boolean;
  draftKey?: string;
  initialPreview?: boolean;
  workspace?: boolean;
  toolbar?: (state: {
    locked: boolean;
    content: string;
    onExport: () => void;
    secondary: ReactNode;
  }) => ReactNode;
  details?: ReactNode;
  children?: ReactNode;
  onLockChange?: (locked: boolean) => void;
  deleteRequested?: boolean;
  cancelDelete?: () => void;
  onDeleted?: () => void;
  done: (memory: Memory, view?: { preview: boolean }) => void;
  cancel: () => void;
}) {
  const drafts = useNoteDrafts();
  const noteExport = useNoteExport();
  const root = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    // Carry deferred-shell focus into the compact toolbar when it becomes ready.
    const heading = root.current
      ?.closest("dialog")
      ?.querySelector(".dialog-heading");
    if (
      heading?.contains(document.activeElement) &&
      !heading.getClientRects().length
    )
      root.current
        ?.querySelector<HTMLButtonElement>(".note-back")
        ?.focus({ preventScroll: true });
  }, []);
  const [preview, setPreview] = useState(initialPreview);
  const api = useWorkspaceApi();
  const [draft] = useState(() =>
    draftKey ? drafts?.get(draftKey) : undefined,
  );
  const [content, setContent] = useState(
    draft?.content ?? memory?.content ?? initialContent,
  );
  const [base, setBase] = useState(draft ? draft.base : memory);
  const [latest, setLatest] = useState<Memory | undefined>(draft?.latest);
  const held = useDraftHeld(base ? `note:${base.id}` : (draftKey ?? ""));
  const [kind, setKind] = useState(draft?.kind ?? memory?.kind ?? initialKind);
  const [retention, setRetention] = useState(
    draft?.retention ??
      String(
        memory
          ? (memory.retentionDays ?? (memory.expiresAt ? 30 : "permanent"))
          : initialKind === "handoff"
            ? 30
            : "permanent",
      ),
  );
  const [autoKind, setAutoKind] = useState(
    draft?.autoKind ?? memory?.autoKind ?? (!memory && !personal),
  );
  const [projectId, setProjectId] = useState(
    draft?.projectId ?? memory?.projectId ?? defaultProject ?? "",
  );
  useSetCurrentNotebook(projectId || null, fullPage);
  const [saving, setSaving] = useState(draft?.saving);
  const [mediaBusy, setMediaBusy] = useState(false);
  const busy = !!saving;
  const [error, setError] = useState(draft?.error ?? "");
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const focusOrigin = useRef<HTMLElement | null>(null);
  const [properties, setProperties] = useState(false);
  const [createNotebook, setCreateNotebook] = useState(false);
  const submitted = useRef<NoteValues | undefined>(draft?.submitted);
  const pageView = fullPage || expanded || workspace;
  const autoSave = fullPage || workspace;
  const setDialogBusy = useDialogBusy();
  const task = useRef(draft?.task ?? memory?.taskId ?? "");
  const pending = useRef<{
    fingerprint: string;
    operationId: string;
    input?: Record<string, unknown>;
  } | null>(draft?.pending ?? null);
  const saveImmediately = useRef(false);
  const dirty = base
    ? content.trim() !== base.content.trim() ||
      kind !== base.kind ||
      projectId !== (base.projectId ?? "") ||
      autoKind !== (base.autoKind ?? false) ||
      retention !==
        String(base.retentionDays ?? (base.expiresAt ? 30 : "permanent"))
    : content.trim().length > 0 && content !== initialContent;
  const receiveSnapshot = useEffectEvent(() => {
    if (!memory || !base || memory.version <= base.version || saving) return;
    // A revalidation must never silently rebase a retained draft or an uncertain save.
    // A response may be lost after our own commit: retry its original operation first.
    if (pending.current) return;
    if (dirty) {
      setLatest(memory);
      return;
    }
    setBase(memory);
    setContent(memory.content);
    setKind(memory.kind);
    setAutoKind(memory.autoKind ?? false);
    setProjectId(memory.projectId ?? "");
    setRetention(
      String(memory.retentionDays ?? (memory.expiresAt ? 30 : "permanent")),
    );
  });
  useEffect(() => {
    const frame = requestAnimationFrame(() => receiveSnapshot());
    return () => cancelAnimationFrame(frame);
  }, [memory, saving]);
  useLayoutEffect(() => {
    if (!focused) return;
    const element = root.current;
    const origin = focusOrigin.current;
    const navigation = [
      ...document.querySelectorAll<HTMLElement>(".app-sidebar, .app-topbar"),
    ];
    const previous = navigation.map((node) => node.inert);
    navigation.forEach((node) => {
      node.inert = true;
    });
    const active = document.activeElement as HTMLElement | null;
    if (
      !active ||
      !element?.contains(active) ||
      !active.getClientRects().length
    )
      element
        ?.querySelector<HTMLElement>(".editor-focus-toggle")
        ?.focus({ preventScroll: true });
    return () => {
      navigation.forEach((node, index) => {
        node.inert = previous[index];
      });
      requestAnimationFrame(() => {
        if (!element?.isConnected || !isActiveSurface(element)) return;
        const target =
          origin?.isConnected && origin.getClientRects().length
            ? origin
            : (element.querySelector<HTMLElement>(
                ".codemirror-host:not([hidden]) .cm-content",
              ) ??
              element.querySelector<HTMLElement>(
                ".editor-modes [aria-pressed=true]",
              ));
        target?.focus({ preventScroll: true });
      });
    };
  }, [focused]);
  useEffect(() => {
    if (!draftKey || !drafts) return;
    const key =
      draftKey.startsWith("new:") && base ? `note:${base.id}` : draftKey;
    if (key !== draftKey) drafts.delete(draftKey);
    if (dirty || saving || latest)
      drafts.set(key, {
        content,
        base,
        latest,
        kind,
        retention,
        autoKind,
        projectId,
        task: task.current,
        pending: pending.current,
        saving,
        submitted: submitted.current,
        error,
      });
    else drafts.delete(key);
  }, [
    drafts,
    draftKey,
    dirty,
    content,
    base,
    latest,
    kind,
    retention,
    autoKind,
    projectId,
    saving,
    error,
  ]);
  const settleSave = useEffectEvent(
    async (
      request: Promise<Memory>,
      result: PromiseSettledResult<Memory>,
      active: () => boolean,
    ) => {
      try {
        if (result.status === "rejected") throw result.reason;
        const saved = result.value;
        const retained = draftKey ? drafts?.get(draftKey) : undefined;
        if (draftKey && retained?.saving !== request) return;
        const values = active()
          ? { content, kind, retention, autoKind, projectId }
          : retained;
        if (!values) return;
        const operationVersion =
          Number(
            pending.current?.input?.expectedVersion ?? base?.version ?? 0,
          ) + 1;
        if (saved.version > operationVersion) {
          // Idempotent replay can return an agent's later version. A successful
          // retry confirms our operation, not permission to overwrite that edit.
          const message =
            "This note changed after your save. Review the newer version before saving again.";
          if (draftKey && drafts) {
            drafts.set(base ? draftKey : `note:${saved.id}`, {
              ...values,
              base: base ?? saved,
              latest: saved,
              task: task.current,
              pending: null,
              error: message,
            });
            if (!base) drafts.delete(draftKey);
          }
          if (active()) {
            pending.current = null;
            submitted.current = undefined;
            setLatest(saved);
            setError(message);
            if (!base) {
              setBase(saved);
              if (fullPage && draftKey) done(saved, { preview });
            }
          }
          return;
        }
        const sent = submitted.current;
        const next = {
          ...values,
          base: saved,
          kind: values.kind === sent?.kind ? saved.kind : values.kind,
          autoKind:
            values.autoKind === sent?.autoKind
              ? (saved.autoKind ?? false)
              : values.autoKind,
          task: task.current,
          pending: null,
          saving: undefined,
          submitted: undefined,
          error: undefined,
        };
        // Preserve typing that happened during the request, including a first-save
        // route change or navigation away and back before the request completed.
        if (draftKey && drafts) {
          const stillDirty =
            next.content.trim() !== saved.content.trim() ||
            next.kind !== saved.kind ||
            next.autoKind !== (saved.autoKind ?? false) ||
            next.projectId !== (saved.projectId ?? "") ||
            next.retention !==
              String(
                saved.retentionDays ?? (saved.expiresAt ? 30 : "permanent"),
              );
          if (stillDirty) drafts.set(`note:${saved.id}`, next);
          else drafts.delete(`note:${saved.id}`);
          if (!base) drafts.delete(draftKey);
        }
        if (!active()) return;
        setBase(saved);
        setKind(next.kind);
        setAutoKind(next.autoKind);
        pending.current = null;
        submitted.current = undefined;
        if (draftKey) noteExport.followSave(draftKey, saved.id);
        done(saved, { preview });
      } catch (e) {
        const retained = draftKey ? drafts?.get(draftKey) : undefined;
        if (retained?.saving === request) retained.error = errorMessage(e);
        if (!active()) return;
        setError(errorMessage(e));
        if (
          e instanceof DashboardApiError &&
          e.code === "version_conflict" &&
          base
        ) {
          try {
            const current = await api<Memory>(`/memories/${base.id}`);
            if (active()) setLatest(current);
          } catch {
            /* Keep the original draft and error if the latest copy is unavailable. */
          }
        }
      } finally {
        const retained = draftKey ? drafts?.get(draftKey) : undefined;
        if (retained?.saving === request) retained.saving = undefined;
        drafts?.notify();
        if (active()) {
          setSaving(undefined);
          setDialogBusy(false);
        }
      }
    },
  );
  useEffect(() => {
    if (!saving) return;
    let active = true;
    const owner = {};
    saveOwners.set(saving, owner);
    const settle = (result: PromiseSettledResult<Memory>) => {
      const current = saveOwners.get(saving);
      if (current && current !== owner) return;
      return settleSave(saving, result, () => active);
    };
    void saving.then(
      (value) => settle({ status: "fulfilled", value }),
      (reason) => settle({ status: "rejected", reason }),
    );
    return () => {
      active = false;
      if (saveOwners.get(saving) === owner) saveOwners.delete(saving);
    };
  }, [saving]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const saveDisabled =
    mediaBusy ||
    busy ||
    !!latest ||
    !content.trim() ||
    content.length > 6000 ||
    !dirty;
  useEffect(() => {
    onLockChange?.(mediaBusy || busy || dirty || !!latest);
  }, [onLockChange, mediaBusy, busy, dirty, latest]);
  function persist() {
    if (mediaBusy) return;
    // Retrying an uncertain save must use its original payload even if newer
    // local edits are empty or exceed the save limit.
    if (saveDisabled && !(pending.current?.input && !busy && !latest)) return;
    if (!pending.current?.input || pending.current.input.content === content)
      saveImmediately.current = false;
    setDialogBusy(!autoSave);
    setError("");
    if (kind === "handoff" && !task.current)
      task.current = `task-${crypto.randomUUID()}`;
    const input = pending.current?.input ?? {
      content,
      kind,
      retentionDays: retention === "permanent" ? null : Number(retention),
      autoKind: kind !== "handoff" && autoKind,
      projectId: projectId || null,
      ...(kind === "handoff" ? { taskId: task.current } : {}),
      source: base?.source ?? { agent: "website" },
      ...(base ? { id: base.id, expectedVersion: base.version } : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = {
        fingerprint,
        operationId: crypto.randomUUID(),
        input,
      };
      submitted.current = { content, kind, retention, autoKind, projectId };
    }
    const request = api<Memory>("/memories", {
      ...input,
      operationId: pending.current.operationId,
    });
    setSaving(request);
    if (draftKey)
      drafts?.set(draftKey, {
        content,
        kind,
        retention,
        autoKind,
        projectId,
        base,
        task: task.current,
        pending: pending.current,
        saving: request,
        submitted: submitted.current,
      });
  }
  const autosave = useEffectEvent(persist);
  const openExport = () =>
    noteExport.open({
      key: draftKey ?? (base ? `note:${base.id}` : "new:compact"),
      snapshot: {
        content,
        unsaved: dirty || busy || !base,
        noteId: base?.id,
        version: base?.version,
      },
    });
  useEffect(() => {
    if (!dirty && !busy) saveImmediately.current = false;
    if (
      !autoSave ||
      saveDisabled ||
      error ||
      held ||
      deleteRequested ||
      mediaBusy
    )
      return;
    if (saveImmediately.current) {
      autosave();
      return;
    }
    const timer = setTimeout(() => autosave(), 450);
    return () => clearTimeout(timer);
  }, [
    autoSave,
    mediaBusy,
    dirty,
    busy,
    saveDisabled,
    error,
    content,
    kind,
    retention,
    autoKind,
    projectId,
    held,
    deleteRequested,
  ]);
  const noteTitle =
    content.match(/^#\s+(.+)/m)?.[1] ||
    content.trim().split("\n")[0].slice(0, 110) ||
    (base ? "Untitled note" : "New note");
  function toggleFocus() {
    if (!focused)
      focusOrigin.current = document.activeElement as HTMLElement | null;
    setFocused(!focused);
  }
  useWorkspaceCommands(
    [
      workspaceCommand("note-export", openExport),
      workspaceCommand("note-mode", () => setPreview(!preview), {
        label: preview ? "Edit note" : "Preview note",
      }),
      {
        ...commandDefinitions["note-save"],
        id: "note-save",
        run: persist,
        disabled: saveDisabled,
        disabledReason: busy
          ? "Saving…"
          : latest
            ? "Review the newer version first"
            : !content.trim()
              ? "Write something first"
              : content.length > 6000
                ? "Over the save limit"
                : !dirty
                  ? "All changes saved"
                  : undefined,
      },
      {
        ...commandDefinitions["note-focus"],
        id: "note-focus",
        run: toggleFocus,
        label: focused ? "Exit focus mode" : "Focus mode",
      },
      workspaceCommand("note-properties", () => setProperties(!properties), {
        label: properties ? "Hide note properties" : "Show note properties",
      }),
    ],
    root,
    noteTitle,
  );
  const saveStatus = busy
    ? "Saving…"
    : dirty
      ? error
        ? "Not saved · retry"
        : content.length > 6000
          ? "Over save limit"
          : !content.trim()
            ? "Empty draft"
            : autoSave
              ? "Waiting to save…"
              : "Unsaved changes"
      : base
        ? `Saved${base.status === "archived" ? " · Archived" : ""}`
        : "Start a note";
  const saveButton = (
    <Button
      type="submit"
      disabled={saveDisabled}
      className="note-save-button"
      aria-label={busy ? "Saving note" : "Save note"}
      title={busy ? "Saving…" : `Save note (${shortcutHint(shortcuts.save)})`}
    >
      <Save size={16} aria-hidden="true" />
      <span>{busy ? "Saving…" : "Save note"}</span>
    </Button>
  );
  const secondary = (
    <>
      <button
        type="button"
        className="note-mobile-menu-item"
        onClick={() => setProperties(!properties)}
      >
        <PanelRight size={16} />{" "}
        {properties ? "Hide note properties" : "Note properties"}
      </button>
      <button
        type="button"
        className="note-mobile-menu-item"
        onClick={toggleFocus}
      >
        <Focus size={16} /> {focused ? "Exit focus mode" : "Focus mode"}
      </button>
      {workspace && !fullPage && !expanded && (
        <button
          type="button"
          className="note-mobile-menu-item"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={16} /> Expand editor
        </button>
      )}
      <CommandMenuButton menuItem />
    </>
  );
  return (
    <>
      <form
        ref={root}
        className={`app-form note-editor${pageView ? " note-editor-full" : ""}${workspace && !fullPage && !expanded && !focused ? " note-editor-drawer" : ""}${focused ? " editor-focus" : ""}`}
        onKeyDown={(event) => {
          if (matchesShortcut(event.nativeEvent, shortcuts.save)) {
            event.preventDefault();
            if (!saveDisabled) event.currentTarget.requestSubmit();
          }
          if (
            event.key === "Escape" &&
            focused &&
            !event.defaultPrevented &&
            isActiveSurface(root.current) &&
            !document.querySelector(":popover-open")
          ) {
            event.preventDefault();
            event.stopPropagation();
            setFocused(false);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (saveDisabled) return;
          persist();
        }}
      >
        <div className="note-editor-bar">
          {pageView ? (
            <>
              <button
                type="button"
                className="app-icon note-back"
                aria-label={
                  expanded
                    ? "Return to compact editor"
                    : workspace && !fullPage
                      ? "Close dialog"
                      : "Back to notes"
                }
                title={expanded ? "Return to compact editor" : "Back to notes"}
                disabled={busy && !autoSave}
                onClick={() => {
                  if (expanded) {
                    setExpanded(false);
                    setFocused(false);
                  } else cancel();
                }}
              >
                <ArrowLeft size={17} />
              </button>
              <div className="note-editor-location">
                <NotebookBreadcrumbs projects={projects} id={projectId} />
                <h1>{noteTitle}</h1>
              </div>
              <span
                className="note-save-status"
                role="status"
                title={autoSave ? "Saves automatically" : undefined}
              >
                <Check
                  size={13}
                  aria-hidden="true"
                  style={{
                    visibility: !busy && !dirty && base ? "visible" : "hidden",
                  }}
                />
                <span title={saveStatus}>{saveStatus}</span>
              </span>
              <button
                type="button"
                className="app-button secondary note-export-button"
                data-focus-key="note-export"
                onClick={openExport}
              >
                <Download size={16} />
                Export
              </button>
              {toolbar ? (
                toolbar({
                  locked: busy || dirty || !!latest,
                  content,
                  secondary,
                  onExport: openExport,
                })
              ) : (
                <span className="note-mobile-actions">
                  <ActionMenu label="Note actions">
                    <button type="button" onClick={openExport}>
                      <Download size={15} />
                      Export…
                    </button>
                    {secondary}
                  </ActionMenu>
                </span>
              )}
              <button
                type="button"
                className="app-icon note-secondary-control"
                aria-label="Note properties"
                title="Note properties"
                aria-expanded={properties}
                onClick={() => setProperties(!properties)}
              >
                <PanelRight size={17} />
              </button>
              <button
                type="button"
                className="app-icon editor-focus-toggle note-secondary-control"
                aria-label={focused ? "Exit focus mode" : "Focus mode"}
                title={focused ? "Exit focus mode" : "Focus mode"}
                aria-pressed={focused}
                onClick={toggleFocus}
              >
                {focused ? <Minimize2 size={17} /> : <Focus size={17} />}
                {focused && <span>Exit focus</span>}
              </button>
              {saveButton}
              {workspace && !fullPage && !expanded && (
                <button
                  type="button"
                  className="app-icon note-secondary-control"
                  aria-label="Expand editor"
                  title="Expand editor"
                  onClick={() => setExpanded(true)}
                >
                  <Maximize2 size={16} />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={15} /> Expand editor
            </button>
          )}
        </div>
        <fieldset
          disabled={busy && !autoSave}
          className="editor-fields"
          aria-busy={busy}
        >
          {latest && (
            <section
              className="note-conflict"
              aria-label="Review newer version"
            >
              <h2>This note has a newer version.</h2>
              <p>
                Your draft is still here. Compare the two, then choose what to
                keep.
              </p>
              <RevisionCompare
                before={latest.content}
                after={content}
                beforeLabel={`Saved version ${latest.version}`}
                afterLabel="Your draft"
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setBase(latest);
                    setContent(latest.content);
                    setKind(latest.kind);
                    setProjectId(latest.projectId ?? "");
                    setAutoKind(latest.autoKind ?? false);
                    setRetention(
                      String(
                        latest.retentionDays ??
                          (latest.expiresAt ? 30 : "permanent"),
                      ),
                    );
                    task.current = latest.taskId ?? "";
                    setLatest(undefined);
                    setError("");
                    pending.current = null;
                    submitted.current = undefined;
                  }}
                >
                  Use saved version
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setBase(latest);
                    setLatest(undefined);
                    setError("");
                    pending.current = null;
                    submitted.current = undefined;
                  }}
                >
                  Keep my draft to replace it
                </Button>
              </div>
              <p>
                The next save creates a new version. Earlier versions stay in
                History.
              </p>
            </section>
          )}
          {guidance && <p className="editor-guidance">{guidance}</p>}
          <div className="note-editor-workspace">
            <MarkdownEditor
              media={
                base
                  ? { noteId: base.id, version: base.version, live: true }
                  : undefined
              }
              upload={
                base && !dirty && !busy && !held && !latest && !deleteRequested
                  ? async (file, signal) => {
                      setMediaBusy(true);
                      try {
                        return await uploadMedia(file, base, signal);
                      } finally {
                        setMediaBusy(false);
                      }
                    }
                  : undefined
              }
              value={content}
              onChange={(value, immediate) => {
                setContent(value);
                if (immediate) saveImmediately.current = true;
                if (!latest) setError("");
              }}
              disabled={mediaBusy || (busy && !autoSave)}
              fullPage={pageView}
              presentation={
                focused
                  ? "focus"
                  : expanded
                    ? "expanded"
                    : workspace && !fullPage
                      ? "drawer"
                      : "page"
              }
              preview={preview}
              onPreviewChange={setPreview}
              placeholder={
                kind === "handoff"
                  ? "# Task name\n\n## Progress\nWhat’s done so far?\n\n## Next steps\n- [ ] What should happen next?"
                  : "Start writing…"
              }
            >
              {children}
            </MarkdownEditor>
            <PropertiesPanel
              overlay={pageView}
              open={properties}
              close={() => setProperties(false)}
            >
              {!personal && (
                <NotebookSelect
                  label="Notebook"
                  value={projectId}
                  onValueChange={setProjectId}
                  projects={projects}
                  disabled={busy}
                />
              )}
              {!personal && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCreateNotebook(true)}
                >
                  New notebook
                </button>
              )}
              <details className="note-options">
                <summary>Note options</summary>
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label="Note type"
                    disabled={busy}
                    value={kind}
                    onValueChange={(value) => {
                      setKind(value as Memory["kind"]);
                      setAutoKind(false);
                      if (!base && value === "handoff") setRetention("30");
                    }}
                    options={[
                      { value: "fact", label: "Note" },
                      { value: "preference", label: "Preference" },
                      { value: "decision", label: "Decision" },
                      { value: "solution", label: "How-to" },
                      { value: "handoff", label: "Progress note" },
                    ]}
                  />
                </div>
                <Select
                  label="Keep this note"
                  disabled={busy}
                  value={retention === "permanent" ? "permanent" : "ephemeral"}
                  onValueChange={(value) =>
                    setRetention(value === "permanent" ? "permanent" : "30")
                  }
                  options={[
                    { value: "permanent", label: "Until I remove it" },
                    { value: "ephemeral", label: "For a limited time" },
                  ]}
                />
                {retention !== "permanent" && (
                  <Select
                    label="Expires after"
                    disabled={busy}
                    value={retention}
                    onValueChange={setRetention}
                    options={[...new Set([1, 7, 30, 90, Number(retention)])]
                      .sort((a, b) => a - b)
                      .map((days) => ({
                        value: String(days),
                        label: `${days} ${days === 1 ? "day" : "days"}`,
                      }))}
                  />
                )}
                <p className="text-xs leading-6 text-muted">
                  {retention === "permanent"
                    ? "Yours to keep. Archive or delete it whenever you like."
                    : "When it expires, this note moves out of search. You have 60 days to restore it before it’s deleted."}
                </p>
                {personal && (
                  <p className="text-sm leading-7 text-muted">
                    Saved outside notebooks. You choose which agents can read
                    it.
                  </p>
                )}
                {kind === "handoff" ? (
                  <p className="text-sm leading-7 text-muted">
                    Keep what’s done and what comes next together, for you and
                    your agents.
                  </p>
                ) : (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={autoKind}
                      onChange={(e) => setAutoKind(e.target.checked)}
                    />
                    Let Grove choose the note type
                  </label>
                )}
              </details>
              {details}
            </PropertiesPanel>
          </div>
          {error && (
            <p role="alert" className="app-error note-save-error">
              {error}
            </p>
          )}
          {!pageView && (
            <div className="flex flex-wrap gap-3">
              {saveButton}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={cancel}
              >
                Cancel
              </Button>
            </div>
          )}
        </fieldset>
      </form>
      {deleteRequested && base && cancelDelete && onDeleted && (
        <NoteDeleteDialog
          memory={base}
          close={cancelDelete}
          onDeleted={onDeleted}
          retrySave={persist}
          conflict={!!latest}
        />
      )}
      {createNotebook && (
        <NotebookDialog
          action={{ mode: "create" }}
          close={() => setCreateNotebook(false)}
          onSaved={(project) => setProjectId(project.id)}
        />
      )}
    </>
  );
}
