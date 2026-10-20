import { createRoot } from "react-dom/client";
import { DashboardShell } from "../../src/components/dashboard/shell";
import { MemoryLibrary } from "../../src/components/dashboard/memory-library";
import { Connections } from "../../src/components/dashboard/connections";
import { ConnectAgent } from "../../src/components/dashboard/connect-agent";
import Projects from "../../src/app/app/projects/page";
import Settings from "../../src/app/app/settings/page";

const path = window.location.pathname;
const content = path.startsWith("/app/connect/") ? (
  <ConnectAgent id={path.split("/").at(-1)!} />
) : path.endsWith("/connections") ? (
  <Connections origin="https://api.grove.example" />
) : path.endsWith("/projects") ? (
  <Projects />
) : path.endsWith("/settings") ? (
  <Settings />
) : (
  <MemoryLibrary archive={path.endsWith("/archive")} />
);
createRoot(document.getElementById("root")!).render(
  <DashboardShell>{content}</DashboardShell>,
);
