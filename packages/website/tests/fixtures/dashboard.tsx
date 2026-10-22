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
import { MemoryInspector } from "../../src/components/dashboard/memory-inspector";
import { NoteEditorPage } from "../../src/components/dashboard/note-editor-page";
import { SettingsPanel } from "../../src/components/dashboard/settings-panel";
import { SettingsFrame } from "../../src/components/dashboard/settings-frame";
import { SourceRevision } from "../../src/components/dashboard/source-revision";

function DashboardFixture() {
  const location = useLocation();
  const [path, search] = location.split("?");
  const query = new URLSearchParams(search);
  const content =
    path === "/app/notes/new" ? (
      <NoteEditorPage
        notebook={query.get("notebook") || undefined}
        journal={query.get("from") === "journal"}
      />
    ) : path.startsWith("/app/memories/") && path.endsWith("/edit") ? (
      <MemoryInspector
        fullPage
        initialPreview={false}
        id={path.split("/")[3]}
        journal={query.get("from") === "journal"}
      />
    ) : path.endsWith("/ask") ? (
      <AskGrove />
    ) : path.endsWith("/journal") ? (
      <MemoryLibrary initialSort="created_desc" />
    ) : path.startsWith("/app/memories/") &&
      Number(query.get("revision")) > 0 ? (
      <SourceRevision
        id={path.split("/").at(-1)!}
        version={Number(query.get("revision"))}
      />
    ) : path.startsWith("/app/memories/") ? (
      <MemoryInspector
        fullPage
        id={path.split("/").at(-1)!}
        initialPreview={query.get("mode") !== "edit"}
        journal={query.get("from") === "journal"}
      />
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
        <SettingsFrame>
          {cloneElement(content, { key: location })}
        </SettingsFrame>
      ) : (
        cloneElement(content, { key: location })
      )}
    </DashboardShell>
  );
}
createRoot(document.getElementById("root")!).render(<DashboardFixture />);
