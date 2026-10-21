"use client";
import {
  useEffect,
  useEffectEvent,
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
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import {
  api,
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import { MarkdownEditor } from "./markdown-editor";
import { useDialogBusy } from "./dialog";
import { Button } from "./ui/button";
import { RevisionCompare } from "./revision-compare";
import { useNoteDrafts, type NoteValues } from "./note-drafts";
import { Select } from "./ui/select";
import { NotebookSelect } from "./notebook-select";
import { NotebookBreadcrumbs } from "./notebook-breadcrumbs";
import { NotebookDialog } from "./notebook-dialog";
import { useWorkspaceDrag } from "./memory-drag";
import { useSetCurrentNotebook } from "./notebooks-provider";
import { useWorkspaceCommands } from "./workspace-commands";

const saveOwners = new WeakMap<Promise<Memory>, object>();

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
  toolbar?: (state: { locked: boolean; content: string }) => ReactNode;
  details?: ReactNode;
  children?: ReactNode;
  onLockChange?: (locked: boolean) => void;
  done: (memory: Memory) => void;
  cancel: () => void;
}) {
  const drafts = useNoteDrafts();
  const root = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState(initialPreview);
  const { refresh: refreshNotes } = useWorkspaceDrag();
  const [draft] = useState(() =>
    draftKey ? drafts?.get(draftKey) : undefined,
  );
  const [content, setContent] = useState(
    draft?.content ?? memory?.content ?? initialContent,
  );
  const [base, setBase] = useState(draft ? draft.base : memory);
  const [latest, setLatest] = useState<Memory>();
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
  const busy = !!saving;
  const [error, setError] = useState(draft?.error ?? "");
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
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
  const dirty = base
    ? content.trim() !== base.content.trim() ||
      kind !== base.kind ||
      projectId !== (base.projectId ?? "") ||
      autoKind !== (base.autoKind ?? false) ||
      retention !==
        String(base.retentionDays ?? (base.expiresAt ? 30 : "permanent"))
    : content.trim().length > 0 && content !== initialContent;
  useEffect(() => {
    if (!focused) return;
    const navigation = [
      ...document.querySelectorAll<HTMLElement>(".app-sidebar, .app-topbar"),
    ];
    const previous = navigation.map((node) => node.inert);
    navigation.forEach((node) => {
      node.inert = true;
    });
    return () =>
      navigation.forEach((node, index) => {
        node.inert = previous[index];
      });
  }, [focused]);
  useEffect(() => {
    if (!draftKey || !drafts) return;
    const key =
      draftKey.startsWith("new:") && base ? `note:${base.id}` : draftKey;
    if (key !== draftKey) drafts.delete(draftKey);
    if (dirty || saving)
      drafts.set(key, {
        content,
        base,
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
        refreshNotes();
        done(saved);
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
    busy || !!latest || !content.trim() || content.length > 6000 || !dirty;
  useEffect(() => {
    onLockChange?.(busy || dirty || !!latest);
  }, [onLockChange, busy, dirty, latest]);
  function persist() {
    if (saveDisabled) return;
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
  useEffect(() => {
    if (!autoSave || saveDisabled || error) return;
    const timer = setTimeout(() => autosave(), 900);
    return () => clearTimeout(timer);
  }, [
    autoSave,
    saveDisabled,
    error,
    content,
    kind,
    retention,
    autoKind,
    projectId,
  ]);
  useWorkspaceCommands(
    [
      {
        id: "note-mode",
        label: preview ? "Edit note" : "Preview note",
        shortcut: "Mod E",
        key: "e",
        run: () => setPreview(!preview),
      },
      {
        id: "note-save",
        label: "Save note",
        shortcut: "Mod S",
        key: "s",
        disabled: saveDisabled,
        run: persist,
      },
      {
        id: "note-focus",
        label: focused ? "Exit focus mode" : "Focus mode",
        shortcut: "Mod Shift F",
        key: "f",
        shift: true,
        run: () => setFocused(!focused),
      },
      {
        id: "note-properties",
        label: properties ? "Hide note properties" : "Show note properties",
        run: () => setProperties(!properties),
      },
    ],
    root,
  );
  const saveButton = (
    <Button
      type="submit"
      disabled={saveDisabled}
      className="note-save-button"
      title={busy ? "Saving…" : "Save note (⌘ / Ctrl S)"}
    >
      <Save size={16} aria-hidden="true" />
      <span>{busy ? "Saving…" : "Save note"}</span>
    </Button>
  );
  return (
    <>
      <form
        ref={root}
        className={`app-form note-editor${pageView ? " note-editor-full" : ""}${workspace && !fullPage && !expanded && !focused ? " note-editor-drawer" : ""}${focused ? " editor-focus" : ""}`}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            if (!saveDisabled) event.currentTarget.requestSubmit();
          }
          if (event.key === "Escape" && focused) {
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
                className="app-icon"
                aria-label={
                  expanded ? "Return to compact editor" : "Back to notes"
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
                <h1>
                  {content.match(/^#\s+(.+)/m)?.[1] ||
                    content.trim().split("\n")[0].slice(0, 110) ||
                    (base ? "Untitled note" : "New note")}
                </h1>
              </div>
              <span className="note-save-status" role="status">
                {busy ? (
                  "Saving…"
                ) : dirty ? (
                  error ? (
                    "Not saved · retry"
                  ) : autoSave ? (
                    "Waiting to save…"
                  ) : (
                    "Unsaved changes"
                  )
                ) : base ? (
                  <>
                    <Check size={13} /> Saved
                    {base.status === "archived" && " · Archived"}
                  </>
                ) : (
                  "Start a note"
                )}
              </span>
              {toolbar?.({ locked: busy || dirty || !!latest, content })}
              <button
                type="button"
                className="app-icon"
                aria-label="Note properties"
                title="Note properties"
                aria-expanded={properties}
                onClick={() => setProperties(!properties)}
              >
                <PanelRight size={17} />
              </button>
              <button
                type="button"
                className="app-icon editor-focus-toggle"
                aria-label={focused ? "Exit focus mode" : "Focus mode"}
                title={focused ? "Exit focus mode" : "Focus mode"}
                aria-pressed={focused}
                onClick={() => setFocused(!focused)}
              >
                {focused ? <Minimize2 size={17} /> : <Focus size={17} />}
                {focused && <span>Exit focus</span>}
              </button>
              {saveButton}
              {workspace && !fullPage && !expanded && (
                <button
                  type="button"
                  className="app-icon"
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
          <div
            className={`note-editor-workspace${pageView && properties ? " has-properties" : ""}`}
          >
            <MarkdownEditor
              value={content}
              onChange={(value) => {
                setContent(value);
                if (!latest) setError("");
              }}
              disabled={busy && !autoSave}
              fullPage={pageView}
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
            <div
              className="note-editor-properties"
              hidden={pageView && !properties}
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
            </div>
          </div>
          {error && (
            <p role="alert" className="app-error">
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
          {pageView && (
            <p className="note-editor-hint">
              {autoSave ? "Saves automatically" : "⌘ / Ctrl S to save"}
              {draftKey && dirty
                ? " · Draft kept while you move around Grove"
                : " · Earlier versions stay in History"}
            </p>
          )}
        </fieldset>
      </form>
      {createNotebook && (
        <NotebookDialog
          action={{}}
          close={() => setCreateNotebook(false)}
          onSaved={(project) => setProjectId(project.id)}
        />
      )}
    </>
  );
}
