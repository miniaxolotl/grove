import { createRoot } from "react-dom/client";
import { DashboardShell } from "../../src/components/dashboard/shell";
import { MemoryLibrary } from "../../src/components/dashboard/memory-library";
import { Connections } from "../../src/components/dashboard/connections";
import { ConnectAgent } from "../../src/components/dashboard/connect-agent";
import Projects from "../../src/app/app/projects/page";
import Settings from "../../src/app/app/settings/page";
import { ModelSettings } from "../../src/components/dashboard/model-settings";
import { MemoryContext } from "../../src/components/dashboard/context";

const path = window.location.pathname;
const content = path.endsWith("/settings/models") ? (
  <ModelSettings />
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
    archive={path.endsWith("/archive")}
    initialId={
      path.startsWith("/app/memories/") ? path.split("/").at(-1) : undefined
    }
  />
);
createRoot(document.getElementById("root")!).render(
  <DashboardShell>{content}</DashboardShell>,
);
