// Real instrumentation behind a test-only, local UI. Never imported by Next.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { DashboardShell } from "../../src/components/dashboard/shell";
import {
  WebsiteTelemetry,
  TelemetryChoice,
} from "../../src/components/website-telemetry";
import { observeDiagnosticsPreference } from "../../src/lib/diagnostics";
import { prepareTelemetryNavigation } from "../../src/lib/analytics";
import { api } from "../../src/lib/dashboard-api";
import { FixtureLink, usePathname } from "./navigation";

observeDiagnosticsPreference();
function Fixture() {
  const path = usePathname();
  const [result, setResult] = useState("");
  return (
    <>
      <WebsiteTelemetry />
      {path.startsWith("/app") ? (
        <DashboardShell>
          <p id="private-note">PRIVATE_NOTE_CONTENT</p>
          <input
            aria-label="Private note"
            defaultValue="PRIVATE_NOTE_CONTENT"
          />
          <button
            onClick={() =>
              api(
                "/memories/PRIVATE_ID?token=PRIVATE_QUERY",
                { content: "PRIVATE_NOTE_CONTENT" },
                "PATCH",
              )
                .then(() => setResult("Saved"))
                .catch(() => setResult("Unavailable"))
            }
          >
            Save note fixture
          </button>
          <p role="status">{result}</p>
        </DashboardShell>
      ) : (
        <main id="main">
          <h1>Public fixture</h1>
          <FixtureLink
            href="/app/projects/PRIVATE_ID?token=PRIVATE_QUERY"
            onClick={prepareTelemetryNavigation}
          >
            Open workspace fixture
          </FixtureLink>
          <TelemetryChoice />
        </main>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
