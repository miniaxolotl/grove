import { createRoot } from "react-dom/client";
import { cloneElement } from "react";
import { useLocation } from "./navigation";
import { DashboardShell } from "../../src/components/dashboard/shell";
import { MemoryLibrary } from "../../src/components/dashboard/memory-library";
import { Connections } from "../../src/components/dashboard/connections";
import { ConnectAgent } from "../../src/components/dashboard/connect-agent";
import Projects from "../../src/app/app/projects/page";
import Settings from "../../src/app/app/settings/page";
import { ModelSettings } from "../../src/components/dashboard/model-settings";
import { MemoryContext } from "../../src/components/dashboard/context";
import { AskGrove } from "../../src/components/dashboard/ask-grove";
import { NoteDocument } from "../../src/components/dashboard/note-document";
import { SettingsPanel } from "../../src/components/dashboard/settings-panel";
import { SettingsFrame } from "../../src/components/dashboard/settings-frame";
import { SourceRevision } from "../../src/components/dashboard/source-revision";
import { BillingPanel } from "../../src/components/dashboard/billing-panel";
import { AdminPanel } from "../../src/components/dashboard/admin-panel";
import { NotebookTools } from "../../src/components/dashboard/notebook-tools";

function DashboardFixture() {
  const location = useLocation();
  const [path, search] = location.split("?");
  const query = new URLSearchParams(search);
  const content = path.endsWith("/tools") ? (
    <NotebookTools />
  ) : path.endsWith("/ask") ? (
    <AskGrove />
  ) : path.endsWith("/journal") ? (
    <MemoryLibrary initialSort="created_desc" />
  ) : path.startsWith("/app/memories/") && Number(query.get("revision")) > 0 ? (
    <SourceRevision
      id={path.split("/").at(-1)!}
      version={Number(query.get("revision"))}
    />
  ) : path === "/app/notes/new" || path.startsWith("/app/memories/") ? (
    <></>
  ) : path.endsWith("/settings/admin") ? (
    <AdminPanel />
  ) : path.endsWith("/settings/billing") ? (
    <BillingPanel />
  ) : path.endsWith("/settings/models") ? (
    <ModelSettings />
  ) : path.endsWith("/settings/account") ? (
    <SettingsPanel section="account" />
  ) : path.endsWith("/settings/data") ? (
    <SettingsPanel section="data" />
  ) : path.endsWith("/profile") ? (
    <MemoryContext />
  ) : path.startsWith("/app/projects/") ? (
    <MemoryContext projectId={path.split("/").at(-1)!} />
  ) : path.startsWith("/app/connect/") ? (
    <ConnectAgent id={path.split("/").at(-1)!} />
  ) : path.endsWith("/connections") ? (
    <Connections origin="https://api.grove.example" />
  ) : path.endsWith("/projects") ? (
    <Projects />
  ) : path.endsWith("/settings") ? (
    <Settings />
  ) : (
    <MemoryLibrary
      initialProject={query.get("notebook") || undefined}
      initialSort={
        query.get("sort") === "created_desc" ? "created_desc" : "updated_desc"
      }
      archive={path.endsWith("/archive")}
      initialView={path.endsWith("/graph") ? "graph" : "list"}
      initialId={
        path.startsWith("/app/memories/") ? path.split("/").at(-1) : undefined
      }
    />
  );
  return (
    <DashboardShell>
      {path.startsWith("/app/settings") || path === "/app/connections" ? (
        <SettingsFrame billing={path.endsWith("/settings/billing")}>
          {cloneElement(content, { key: location })}
        </SettingsFrame>
      ) : path === "/app/notes/new" || path.startsWith("/app/memories/") ? (
        <NoteDocument>{content}</NoteDocument>
      ) : (
        cloneElement(content, { key: location })
      )}
    </DashboardShell>
  );
}
createRoot(document.getElementById("root")!).render(<DashboardFixture />);
