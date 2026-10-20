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

export function MemoryContext({
  projectId = null,
}: {
  projectId?: string | null;
}) {
  const [view, setView] = useState("context");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(!!projectId);
  const [error, setError] = useState("");
  const [create, setCreate] = useState<Memory["kind"] | null>(null);
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
  if (loading) return <p role="status">Opening project…</p>;
  if (projectId && !project)
    return (
      <>
        <h1 className="font-editorial text-4xl">Project unavailable</h1>
        <LoadError
          message={error || "This project could not be found in your account."}
          retry={() => setRefresh((v) => v + 1)}
        />
        <Link href="/app/projects" className="app-button secondary">
          Back to projects
        </Link>
      </>
    );
  return (
    <>
      {projectId && (
        <Link href="/app/projects" className="workspace-back">
          <ArrowLeft size={15} />
          Projects
        </Link>
      )}
      <div className="app-page-heading">
        <div>
          <h1>{project?.name ?? "Personal context"}</h1>
          <p>
            {project
              ? "Your notes, decisions, and next steps in one place."
              : "Preferences and useful facts that travel with you across projects."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {project && (
            <button
              className="app-button secondary"
              onClick={() => setRename(true)}
            >
              <Pencil size={15} />
              Rename
            </button>
          )}
          <button className="app-button" onClick={() => setCreate("fact")}>
            <Plus size={16} />
            Add memory
          </button>
        </div>
      </div>
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      {error && (
        <LoadError message={error} retry={() => setRefresh((v) => v + 1)} />
      )}
      <nav className="workspace-tabs" aria-label="Workspace views">
        {[
          { id: "context", label: "Overview" },
          { id: "memories", label: "Memories" },
          { id: "handoffs", label: "Handoffs" },
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
      {view === "context" && (
        <div className="context-layout">
          <BriefPanel key={refresh} projectId={projectId} />
          <aside className="context-guide">
            <h2>Make this context useful</h2>
            <p>
              Save decisions and conventions as memories. This overview brings
              them together and links each point to its source.
            </p>
            <button className="text-button" onClick={() => setView("memories")}>
              Browse source memories
            </button>
            <h3>Work in progress?</h3>
            <p>
              Keep a handoff for a task’s progress and next steps. Choose it by
              title when you return.
            </p>
            <button className="text-button" onClick={() => setView("handoffs")}>
              Browse handoffs
            </button>
            <Link href="/app/settings/models" className="context-how">
              How search and summaries work
            </Link>
          </aside>
        </div>
      )}
      {view === "memories" && (
        <MemoryLibrary key={refresh} embedded projectId={projectId} />
      )}
      {view === "handoffs" && (
        <Handoffs
          key={refresh}
          projectId={projectId}
          onCreate={() => setCreate("handoff")}
        />
      )}
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
          title={create === "handoff" ? "New handoff" : "New memory"}
          close={() => setCreate(null)}
        >
          <MemoryEditor
            projects={projects}
            projectId={projectId}
            initialKind={create}
            cancel={() => setCreate(null)}
            done={() => {
              setCreate(null);
              setNotice("Memory saved. Your context is updating.");
              setRefresh((v) => v + 1);
            }}
          />
        </Dialog>
      )}
      {rename && project && (
        <Dialog title="Rename project" close={() => setRename(false)}>
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
