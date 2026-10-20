"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, ArrowLeft } from "lucide-react";
import type { Memory } from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { BriefPanel } from "./brief";
import { MemoryLibrary } from "./memory-library";
import { MemoryEditor } from "./memory-editor";
import { ProjectForm } from "./project-form";
import { Handoffs } from "./handoffs";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { PageHeading } from "./ui/page-heading";
import { Button } from "./ui/button";
import { Disclosure } from "./ui/disclosure";
import { PersonalOptions, type ContextPrompt } from "./personal-options";
import { AskGrove } from "./ask-grove";

export function MemoryContext({
  projectId = null,
}: {
  projectId?: string | null;
}) {
  const [view, setView] = useState(projectId ? "memories" : "context");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(!!projectId);
  const [error, setError] = useState("");
  const [create, setCreate] = useState<Memory["kind"] | null>(null);
  const [prompt, setPrompt] = useState<ContextPrompt | null>(null);
  const [rename, setRename] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<Project[]>("/projects", undefined, undefined, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setProjects(list);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  const project = projects.find((p) => p.id === projectId);
  if (loading) return <p role="status">Opening notebook…</p>;
  if (projectId && !project)
    return (
      <>
        <h1 className="font-editorial text-4xl">Notebook unavailable</h1>
        <LoadError
          message={error || "This notebook could not be found in your account."}
          retry={() => setRefresh((v) => v + 1)}
        />
        <Link href="/app/projects" className="app-button secondary">
          Back to notebooks
        </Link>
      </>
    );
  return (
    <>
      {projectId && (
        <Link href="/app/projects" className="workspace-back">
          <ArrowLeft size={15} />
          Notebooks
        </Link>
      )}
      <PageHeading
        title={project?.name ?? "About me"}
        description={
          project
            ? "A home for your notes and ideas."
            : "The little things that make your notebook yours."
        }
        actions={
          view !== "memories" && (
            <>
              {project && (
                <Button variant="secondary" onClick={() => setRename(true)}>
                  <Pencil size={15} />
                  Rename
                </Button>
              )}
              <Button
                onClick={() => {
                  setPrompt(null);
                  setCreate(project ? "fact" : "preference");
                }}
              >
                <Plus size={16} />
                {project ? "New note" : "Add a little about me"}
              </Button>
            </>
          )
        }
      />
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      {error && (
        <LoadError message={error} retry={() => setRefresh((v) => v + 1)} />
      )}
      <nav className="workspace-tabs" aria-label="Workspace views">
        {(project
          ? [
              { id: "memories", label: "Notes" },
              { id: "context", label: "Summary" },
              { id: "handoffs", label: "In progress" },
              { id: "ask", label: "Ask Grove" },
            ]
          : [
              { id: "context", label: "Overview" },
              { id: "preferences", label: "Preferences" },
              { id: "facts", label: "My notes" },
            ]
        ).map((tab) => (
          <button
            key={tab.id}
            aria-pressed={view === tab.id}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
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
              <Link href="/app/settings/models" className="context-how">
                How search and summaries work
              </Link>
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
                <Link href="/app/connections" className="text-button">
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
              setNotice("Note saved.");
              setRefresh((v) => v + 1);
            }}
          />
        </Dialog>
      )}
      {rename && project && (
        <Dialog title="Rename notebook" close={() => setRename(false)}>
          <ProjectForm
            project={project}
            done={() => {
              setRename(false);
              setRefresh((v) => v + 1);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
