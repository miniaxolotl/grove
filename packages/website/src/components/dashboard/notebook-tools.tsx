"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CalendarDays,
  FileText,
  GraduationCap,
  Search,
  Lightbulb,
} from "lucide-react";
import {
  notebookWorkflows,
  toolKinds,
  toolRequestSchema,
  workflowScopeLabel,
  type NotebookWorkflowKind,
  type WorkflowScope,
  type ToolRequest,
} from "@lib/shared/notebook-workflows";
import type { AccountSettings } from "@lib/shared/account-settings";
import type { Memory } from "@lib/shared/contracts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useNotebooks } from "./notebooks-provider";
import { Dialog } from "./dialog";
import { Button } from "./ui/button";
import { PageHeading } from "./ui/page-heading";
import { LoadError } from "./load-error";
import { AssistancePanel } from "./assistance-panel";

const icons = {
  weekly_review: CalendarDays,
  preparation: FileText,
  study: GraduationCap,
  knowledge_gaps: Lightbulb,
  similar_problems: Search,
};
type SourcePage = { items: Memory[]; nextCursor: string | null };
type Draft = {
  goal: string;
  title: string;
  audience: string;
  topic: string;
  problem: string;
  format: "quiz" | "flashcards" | "explanations";
  size: number;
  detail: "brief" | "standard" | "detailed";
  weekStart: string;
  timeZone: string;
  scopeKind: WorkflowScope["kind"];
  ids: string[];
  descendants: boolean;
  pins: { id: string; version: number }[];
};
function initialDraft(scope?: WorkflowScope): Draft {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)!.value;
  const date = new Date(
    `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
  return {
    goal: "",
    title: "",
    audience: "",
    topic: "",
    problem: "",
    format: "quiz",
    size: 6,
    detail: "standard",
    weekStart: date.toISOString().slice(0, 10),
    timeZone,
    scopeKind: scope?.kind ?? "notebooks",
    ids: scope?.kind === "notebooks" ? scope.ids : [],
    descendants: scope?.kind === "notebooks" ? scope.includeDescendants : false,
    pins: scope?.kind === "notes" ? scope.sources : [],
  };
}

export function NotebookTools({
  initialScope,
  close,
}: {
  initialScope?: WorkflowScope;
  close?: () => void;
}) {
  const [selected, setSelected] = useState<NotebookWorkflowKind>();
  const [drafts, setDrafts] = useState<
    Partial<Record<NotebookWorkflowKind, Draft>>
  >({});
  const choose = (kind: NotebookWorkflowKind) => {
    setDrafts((old) => ({
      ...old,
      [kind]: old[kind] ?? initialDraft(initialScope),
    }));
    setSelected(kind);
  };
  if (selected)
    return (
      <ToolForm
        kind={selected}
        draft={drafts[selected]!}
        change={(draft) => setDrafts((old) => ({ ...old, [selected]: draft }))}
        back={() => setSelected(undefined)}
        close={close ?? (() => setSelected(undefined))}
      />
    );
  const content = (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Choose a tool, then choose exactly which notes it can use. Nothing runs
        until you ask.
      </p>
      {toolKinds.map((kind) => {
        const tool = notebookWorkflows[kind],
          Icon = icons[kind];
        return (
          <section
            key={kind}
            className="flex flex-wrap items-center gap-4 border-b py-5"
          >
            <Icon size={22} aria-hidden="true" />
            <div className="min-w-0 flex-1 basis-48">
              <h2 className="text-lg font-semibold">{tool.title}</h2>
              <p className="text-sm text-muted break-words">
                {tool.description}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => choose(kind)}
              aria-label={`Open ${tool.title}`}
            >
              Open
            </Button>
          </section>
        );
      })}
    </div>
  );
  return close ? (
    <Dialog title="Tools" close={close}>
      {content}
    </Dialog>
  ) : (
    <>
      <PageHeading
        title="Tools"
        description="Review, prepare, learn and find useful context in your saved notes."
      />
      {content}
    </>
  );
}

function ToolForm({
  kind,
  draft,
  change,
  back,
  close,
}: {
  kind: NotebookWorkflowKind;
  draft: Draft;
  change: (draft: Draft) => void;
  back: () => void;
  close: () => void;
}) {
  const cache = useWorkspaceCache();
  const { projects } = useNotebooks();
  const settings = useQuery(
    cache.resource<
      AccountSettings & { aiAvailability?: { generation: boolean } }
    >("/me"),
  );
  const [request, setRequest] = useState<ToolRequest | null>(null);
  const { scopeKind, ids, descendants, pins } = draft;
  const setScopeKind = (value: WorkflowScope["kind"]) =>
    change({ ...draft, scopeKind: value });
  const setIds = (value: (old: string[]) => string[]) =>
    change({ ...draft, ids: value(ids) });
  const setDescendants = (value: boolean) =>
    change({ ...draft, descendants: value });
  const setPins = (value: (old: Draft["pins"]) => Draft["pins"]) =>
    change({ ...draft, pins: value(pins) });
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [after, setAfter] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(false);
  const [enabledHere, setEnabledHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setAfter(null);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const notes = useQuery({
    ...cache.resource<SourcePage>("/memories/search", {
      query,
      limit: 20,
      ...(after ? { after } : {}),
    }),
    enabled: scopeKind === "notes" && !request,
    staleTime: 0,
  });
  const preference = notebookWorkflows[kind].preference;
  const enabled = enabledHere || settings.data?.[preference] === true;
  const unavailable = settings.data?.aiAvailability?.generation === false;
  const scope: WorkflowScope =
    scopeKind === "library"
      ? { kind: "library" }
      : scopeKind === "notes"
        ? { kind: "notes", sources: pins }
        : { kind: "notebooks", ids, includeDescendants: descendants };
  const scopeReady =
    scopeKind === "library" ||
    (scopeKind === "notes" ? pins.length > 0 : ids.length > 0);
  const goalReady =
    kind === "preparation"
      ? !!draft.goal.trim()
      : kind === "similar_problems"
        ? !!draft.problem.trim()
        : kind === "weekly_review"
          ? !!draft.weekStart && !!draft.timeZone
          : true;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    change({ ...draft, [key]: value });
  if (request)
    return (
      <AssistancePanel
        initial={request}
        close={close}
        back={() => {
          setRequest(null);
          setError("");
        }}
      />
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      busy ||
      !scopeReady ||
      !goalReady ||
      (!enabled && !optIn) ||
      unavailable
    )
      return;
    setBusy(true);
    setError("");
    try {
      const options =
        kind === "preparation"
          ? {
              goal: draft.goal,
              ...(draft.title ? { title: draft.title } : {}),
              ...(draft.audience ? { audience: draft.audience } : {}),
            }
          : kind === "study"
            ? { topic: draft.topic, format: draft.format, size: draft.size }
            : kind === "weekly_review"
              ? { weekStart: draft.weekStart, timeZone: draft.timeZone }
              : kind === "similar_problems"
                ? { problem: draft.problem }
                : { topic: draft.topic };
      const input = toolRequestSchema.parse({
        id: crypto.randomUUID(),
        kind,
        scope,
        detail: draft.detail,
        ...options,
      });
      if (!enabled) {
        await cache.api("/account/settings", { [preference]: true }, "PATCH");
        setEnabledHere(true);
        void settings.refetch();
      }
      setRequest(input);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={notebookWorkflows[kind].title} close={close} busy={busy}>
      <form className="app-form" onSubmit={(event) => void submit(event)}>
        <button type="button" className="text-button text-sm" onClick={back}>
          Back to tools
        </button>
        <p className="text-sm text-muted">
          {notebookWorkflows[kind].description}
        </p>
        {kind === "preparation" && (
          <>
            <label className="app-label">
              What should this brief help you do?
              <textarea
                className="app-input"
                rows={3}
                value={draft.goal}
                maxLength={1000}
                required
                onChange={(event) => update("goal", event.target.value)}
                placeholder="Understand a topic, plan a handoff, prepare for an interview…"
              />
            </label>
            <details>
              <summary>Details (optional)</summary>
              <div className="space-y-3 pt-3">
                <label className="app-label">
                  Brief title
                  <input
                    className="app-input"
                    value={draft.title}
                    maxLength={120}
                    onChange={(event) => update("title", event.target.value)}
                  />
                </label>
                <label className="app-label">
                  Audience or context
                  <input
                    className="app-input"
                    value={draft.audience}
                    maxLength={240}
                    onChange={(event) => update("audience", event.target.value)}
                  />
                </label>
              </div>
            </details>
          </>
        )}
        {(kind === "study" || kind === "knowledge_gaps") && (
          <label className="app-label">
            Focus (optional)
            <input
              className="app-input"
              value={draft.topic}
              maxLength={1000}
              onChange={(event) => update("topic", event.target.value)}
            />
          </label>
        )}
        {kind === "similar_problems" && (
          <label className="app-label">
            What are you trying to solve?
            <textarea
              className="app-input"
              rows={3}
              value={draft.problem}
              required
              maxLength={1000}
              onChange={(event) => update("problem", event.target.value)}
              placeholder="Describe the situation, constraints and outcome you need."
            />
          </label>
        )}
        {kind === "weekly_review" && (
          <>
            <label className="app-label">
              Week beginning (Monday)
              <input
                className="app-input"
                type="date"
                value={draft.weekStart}
                required
                onChange={(event) => update("weekStart", event.target.value)}
              />
            </label>
            <label className="app-label">
              Timezone
              <input
                className="app-input"
                value={draft.timeZone}
                required
                maxLength={80}
                onChange={(event) => update("timeZone", event.target.value)}
              />
            </label>
            <p className="text-xs text-muted">
              Runs only when you ask. Includes older unfinished actions. No
              recurring schedule is enabled.
            </p>
          </>
        )}
        {kind === "study" && (
          <div className="flex flex-wrap gap-4">
            <label className="app-label min-w-0 flex-1">
              Format
              <select
                className="app-input"
                value={draft.format}
                onChange={(event) =>
                  update("format", event.target.value as Draft["format"])
                }
              >
                <option value="quiz">Quiz</option>
                <option value="flashcards">Flashcards</option>
                <option value="explanations">Explanations</option>
              </select>
            </label>
            <label className="app-label">
              Items (up to 12)
              <input
                className="app-input"
                type="number"
                min={1}
                max={12}
                value={draft.size}
                onChange={(event) => update("size", Number(event.target.value))}
              />
            </label>
          </div>
        )}
        <label className="app-label">
          Detail
          <select
            className="app-input"
            value={draft.detail}
            onChange={(event) =>
              update("detail", event.target.value as Draft["detail"])
            }
          >
            <option value="brief">Brief</option>
            <option value="standard">Standard</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
        <fieldset className="space-y-3">
          <legend className="font-medium">Sources</legend>
          <label className="app-label">
            Source scope
            <select
              className="app-input"
              value={scopeKind}
              onChange={(event) =>
                setScopeKind(event.target.value as WorkflowScope["kind"])
              }
            >
              <option value="notebooks">Selected notebooks</option>
              <option value="notes">Selected notes</option>
              <option value="library">My active library</option>
            </select>
          </label>
          {scopeKind === "notebooks" && (
            <>
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex min-h-11 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={ids.includes(project.id)}
                      onChange={(event) =>
                        setIds((old) =>
                          event.target.checked
                            ? [...old, project.id]
                            : old.filter((id) => id !== project.id),
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      {project.name}
                      {project.parentId
                        ? ` (in ${projects.find((parent) => parent.id === project.parentId)?.name ?? "a sub-notebook"})`
                        : ""}
                    </span>
                  </label>
                ))}
                {!projects.length && (
                  <p className="text-sm text-muted">
                    No notebooks yet. Select notes or choose your active
                    library.
                  </p>
                )}
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={descendants}
                  onChange={(event) => setDescendants(event.target.checked)}
                />
                Include sub-notebooks
              </label>
            </>
          )}
          {scopeKind === "notes" && (
            <>
              <details open={pins.length > 0}>
                <summary>Selected notes ({pins.length})</summary>
                <ul className="space-y-2 pt-2">
                  {pins.map((pin, index) => (
                    <li
                      key={pin.id}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="break-words">
                          {notes.data?.items
                            .find((note) => note.id === pin.id)
                            ?.content.split("\n")[0]
                            .replace(/^#+\s*/, "")
                            .slice(0, 120) || `Selected note ${index + 1}`}
                        </p>
                        <Link
                          className="text-button text-xs"
                          href={`/app/memories/${pin.id}?revision=${pin.version}`}
                        >
                          Revision {pin.version}
                        </Link>
                      </div>
                      <button
                        className="text-button min-h-11 shrink-0"
                        type="button"
                        aria-label={`Remove selected note ${index + 1}`}
                        onClick={(event) => {
                          event.currentTarget
                            .closest("details")
                            ?.querySelector("summary")
                            ?.focus();
                          setPins((old) =>
                            old.filter((ref) => ref.id !== pin.id),
                          );
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
              <label className="app-label">
                Find source notes
                <input
                  className="app-input"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {notes.error ? (
                <LoadError
                  message={errorMessage(notes.error)}
                  retry={() => void notes.refetch()}
                />
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                  {notes.data?.items.map((note) => (
                    <label
                      className="flex min-h-11 items-center gap-3 text-sm"
                      key={note.id}
                    >
                      <input
                        type="checkbox"
                        checked={pins.some((pin) => pin.id === note.id)}
                        onChange={(event) =>
                          setPins((old) =>
                            event.target.checked
                              ? [...old, { id: note.id, version: note.version }]
                              : old.filter((pin) => pin.id !== note.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {note.content
                          .split("\n")[0]
                          .replace(/^#+\s*/, "")
                          .slice(0, 120)}
                      </span>
                    </label>
                  ))}
                  {notes.isPending && <p role="status">Opening notes…</p>}
                  {notes.data && !notes.data.items.length && (
                    <p>No matching notes.</p>
                  )}
                </div>
              )}
              <div className="app-actions">
                {after && (
                  <button
                    className="text-button min-h-11"
                    type="button"
                    onClick={() => setAfter(null)}
                  >
                    First page
                  </button>
                )}
                {notes.data?.nextCursor && (
                  <button
                    className="text-button min-h-11"
                    type="button"
                    onClick={() => setAfter(notes.data!.nextCursor!)}
                  >
                    More notes
                  </button>
                )}
              </div>
            </>
          )}
          {scopeKind === "library" && (
            <p className="text-sm text-muted">
              Only your active notes, including Unfiled and active
              sub-notebooks. No archived, deleted, expired or other-account
              notes.
            </p>
          )}
          {scopeReady && (
            <p className="text-xs text-muted">
              {workflowScopeLabel(scope)}. Large scopes are reviewed in bounded
              batches; coverage and Review more sources show what remains.
            </p>
          )}
        </fieldset>
        {settings.error && (
          <LoadError
            message={errorMessage(settings.error)}
            retry={() => void settings.refetch()}
          />
        )}
        {!enabled && settings.data && (
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={optIn}
              onChange={(event) => setOptIn(event.target.checked)}
            />
            <span>
              Enable {notebookWorkflows[kind].title}. Generate only when I ask;
              one result uses one assistance action, including Review more
              sources.
            </span>
          </label>
        )}
        {unavailable && (
          <p className="text-sm text-muted">
            A generation provider is unavailable.{" "}
            <Link className="text-button" href="/app/settings/models">
              Open AI &amp; search settings
            </Link>
            .
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <p className="text-xs text-muted">
          Read-only until you review and save. Original notes are never
          rewritten by these tools.
        </p>
        <Button
          type="submit"
          disabled={
            busy ||
            !settings.data ||
            unavailable ||
            !scopeReady ||
            !goalReady ||
            (!enabled && !optIn)
          }
        >
          {busy
            ? "Starting…"
            : !enabled && optIn
              ? "Enable and create"
              : kind === "preparation"
                ? "Create brief"
                : "Create result"}
        </Button>
      </form>
    </Dialog>
  );
}
