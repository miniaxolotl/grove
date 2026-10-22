import Link from "next/link";
import type { ModelSettings } from "@lib/shared/models";

export function ProviderOverview({ settings }: { settings: ModelSettings }) {
  return (
    <div className="settings-content">
      <p className="settings-section-description">
        {settings.edition === "cloud"
          ? "Grove Cloud manages these services for you."
          : "Your installation administrator manages these services."}{" "}
        Availability is separate from the features you enable in Preferences.
      </p>
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
            <span
              className="settings-badge"
              data-available={settings.config[role].provider !== "disabled"}
            >
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
        Choose AI preferences
      </Link>
    </div>
  );
}
