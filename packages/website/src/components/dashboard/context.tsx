"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  CalendarDays,
  MessageSquare,
  AlignLeft,
  ListTodo,
} from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { deferredFeature } from "./deferred-feature";
import { MemoryLibrary } from "./memory-library";
import { useToast } from "./toasts";
import { NotebookDialog, type NotebookAction } from "./notebook-dialog";
import { useNotebooks } from "./notebooks-provider";
import { NotebookBreadcrumbs } from "./notebook-breadcrumbs";
import { NotebookTree } from "./notebook-tree";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { PageHeading } from "./ui/page-heading";
import { Button } from "./ui/button";
import { Disclosure } from "./ui/disclosure";
import { PersonalOptions, type ContextPrompt } from "./personal-options";
import { ActionMenu } from "./ui/action-menu";
import { NotebookActions } from "./notebook-actions";
const BriefPanel = deferredFeature(
  async () => ({ default: (await import("./brief")).BriefPanel }),
  "Opening summary…",
);
const Handoffs = deferredFeature(
  async () => ({ default: (await import("./handoffs")).Handoffs }),
  "Opening progress notes…",
);
const AskGrove = deferredFeature(
  async () => ({ default: (await import("./ask-grove")).AskGrove }),
  "Opening Ask Grove…",
);
const MemoryEditor = deferredFeature(
  async () => ({ default: (await import("./memory-editor")).MemoryEditor }),
  "Opening your writing space…",
);

export function MemoryContext({
  projectId = null,
}: {
  projectId?: string | null;
}) {
  const [view, setView] = useState(projectId ? "memories" : "context");
  const { projects, loading, error, reload } = useNotebooks();
  const [create, setCreate] = useState<Memory["kind"] | null>(null);
  const [prompt, setPrompt] = useState<ContextPrompt | null>(null);
  const [notebookAction, setNotebookAction] = useState<NotebookAction | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const toast = useToast();
  const project = projects.find((p) => p.id === projectId);
  if (!loading && projectId && !project)
    return (
      <>
        <h1 className="font-editorial text-4xl">Notebook unavailable</h1>
        <LoadError
          message={error || "This notebook could not be found in your account."}
          retry={reload}
        />
        <Link href="/app/projects" className="app-button secondary">
          Back to notebooks
        </Link>
      </>
    );
  return (
    <>
      {projectId && (
        <NotebookBreadcrumbs projects={projects} id={projectId} current />
      )}
      <PageHeading
        title={project?.name ?? (projectId ? "Opening notebook…" : "About you")}
        description={
          project
            ? undefined
            : "The little things that make your notebook yours."
        }
        actions={
          (project || view !== "memories") && (
            <>
              {project && (
                <>
                  <Link
                    className="app-button secondary"
                    href={`/app/notes/new?from=journal&notebook=${project.id}`}
                  >
                    <CalendarDays size={16} />
                    Today’s note
                  </Link>
                  <ActionMenu label="Notebook options">
                    <NotebookActions
                      project={project}
                      onAction={setNotebookAction}
                    />
                    <button
                      className="action-group-start"
                      onClick={() => setView("ask")}
                    >
                      <MessageSquare size={15} />
                      Ask about these notes
                    </button>
                    <button onClick={() => setView("context")}>
                      <AlignLeft size={15} />
                      Summarize notebook
                    </button>
                    <button onClick={() => setView("handoffs")}>
                      <ListTodo size={15} />
                      Progress notes
                    </button>
                  </ActionMenu>
                </>
              )}
              {!project && view !== "memories" && (
                <Button
                  onClick={() => {
                    setPrompt(null);
                    setCreate(project ? "fact" : "preference");
                  }}
                >
                  <Plus size={16} />
                  {project ? "New note" : "Add a little about me"}
                </Button>
              )}
            </>
          )
        }
      />
      {error && <LoadError message={error} retry={reload} />}
      {project && view !== "memories" && (
        <button
          className="text-button mb-4"
          onClick={() => setView("memories")}
        >
          Back to notes
        </button>
      )}
      {!projectId && (
        <nav className="workspace-tabs" aria-label="Workspace views">
          {[
            { id: "context", label: "Overview" },
            { id: "preferences", label: "Preferences" },
            { id: "facts", label: "My notes" },
          ].map((tab) => (
            <button
              key={tab.id}
              aria-pressed={view === tab.id}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}
      {project &&
        view === "memories" &&
        projects.some((p) => p.parentId === project.id) && (
          <section className="sub-notebooks" aria-label="Sub-notebooks">
            <h2>Sub-notebooks</h2>
            <NotebookTree
              projects={projects.filter((p) => p.parentId === project.id)}
            />
          </section>
        )}
      {view === "context" && (
        <div className="context-layout">
          <BriefPanel key={refresh} projectId={projectId} />
          {project ? (
            <aside className="context-guide">
              <h2>The story so far</h2>
              <p>
                A short summary of your notebook, with links back to the notes.
              </p>
              <button
                className="text-button"
                onClick={() => setView("memories")}
              >
                Browse notes
              </button>
              <h3>Work in progress?</h3>
              <p>Jot down where you left off, so it’s easy to return.</p>
              <button
                className="text-button"
                onClick={() => setView("handoffs")}
              >
                See what’s in progress
              </button>
            </aside>
          ) : (
            <div>
              <PersonalOptions
                onCreate={(value) => {
                  setPrompt(value);
                  setCreate(value.kind);
                }}
              />
              <Disclosure title="Sharing with your agents">
                <p>
                  Choose which agents can read your personal notes in
                  Connections.
                </p>
                <p>
                  You can edit any note. This overview follows your changes.
                </p>
                <Link href="/app/settings/connections" className="text-button">
                  Manage agent access
                </Link>
              </Disclosure>
            </div>
          )}
        </div>
      )}
      {["memories", "preferences", "facts", "graph"].includes(view) && (
        <MemoryLibrary
          key={`${refresh}:${view}`}
          embedded
          initialView={view === "graph" ? "graph" : "list"}
          projectId={projectId}
          initialKind={
            view === "preferences"
              ? "preference"
              : view === "facts"
                ? "fact"
                : ""
          }
        />
      )}
      {view === "handoffs" && (
        <Handoffs
          key={refresh}
          projectId={projectId}
          onCreate={() => setCreate("handoff")}
        />
      )}
      {view === "ask" && <AskGrove projectId={projectId} embedded />}
      {project && (
        <details className="agent-details project-agent-details">
          <summary>Agent details</summary>
          <dl>
            <dt>Project reference</dt>
            <dd>{project.id}</dd>
            <dt>Repository identity</dt>
            <dd>{project.identity}</dd>
          </dl>
          <p>
            Agents use these stable references to share the same project across
            sessions. A project’s name can change without breaking its
            connections.
          </p>
        </details>
      )}
      {create && (
        <Dialog
          panel
          title={create === "handoff" ? "Progress note" : "New note"}
          close={() => setCreate(null)}
        >
          <MemoryEditor
            projects={projects}
            projectId={projectId}
            initialKind={create}
            initialContent={prompt ? `# ${prompt.title}\n\n` : ""}
            guidance={prompt?.guidance}
            personal={!projectId}
            cancel={() => setCreate(null)}
            done={() => {
              setCreate(null);
              toast("Note saved.");
              setRefresh((v) => v + 1);
            }}
          />
        </Dialog>
      )}
      {notebookAction && (
        <NotebookDialog
          action={notebookAction}
          close={() => setNotebookAction(null)}
        />
      )}
    </>
  );
}
