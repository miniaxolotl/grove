import Link from "next/link";
import type { ModelSettings } from "@lib/shared/models";

export function ProviderOverview({ settings }: { settings: ModelSettings }) {
  return (
    <div className="settings-content">
      <section className="app-panel feature-availability">
        {(
          [
            ["embedding", "Search your notes"],
            ["decision", "Related ideas"],
            ["generation", "Answers and summaries"],
          ] as const
        ).map(([role, label]) => (
          <div key={role}>
            <span>{label}</span>
            <span>
              {settings.config[role].provider === "disabled"
                ? "Unavailable"
                : "Ready"}
            </span>
          </div>
        ))}
      </section>
      <Link className="text-button" href="/app/settings">
        Preferences
      </Link>
    </div>
  );
}
