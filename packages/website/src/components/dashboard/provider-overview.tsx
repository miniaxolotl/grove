import Link from "next/link";
import type { ModelSettings } from "@lib/shared/models";

export function ProviderOverview({ settings }: { settings: ModelSettings }) {
  return (
    <div className="settings-content">
      <section className="app-panel feature-availability">
        {(
          [
            ["embedding", "Search your notes"],
            ["decision", "Note classification"],
            ["generation", "Titles and tags"],
            ["generation", "Note and notebook connections"],
            ["generation", "Summaries and Ask Grove"],
          ] as const
        ).map(([role, label]) => (
          <div key={label}>
            <span>{label}</span>
            <span>
              {settings.config[role].provider === "disabled"
                ? role === "embedding"
                  ? "Keyword search"
                  : "Unavailable"
                : "Available"}
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
