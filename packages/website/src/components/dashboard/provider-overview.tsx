import Link from "next/link";
import { Search, FolderOpen, FileText } from "lucide-react";
import type { ModelSettings } from "@lib/shared/models";

export function ProviderOverview({ settings }: { settings: ModelSettings }) {
  const roles = [
    {
      role: "embedding" as const,
      title: "Find the right memory",
      icon: Search,
      description:
        "Search by meaning as well as matching words. A question about pull-request feedback can find your saved code-review preferences.",
      detail:
        "Qwen turns notes and queries into comparable search vectors. Grove searches only the memories available in the requested account and project.",
    },
    {
      role: "decision" as const,
      title: "Keep things organized",
      icon: FolderOpen,
      description:
        "Classifies notes and identifies related, duplicate, or conflicting memories. Choose automatic kinds when you want Grove to categorize a note for you.",
      detail:
        "Clef Flash chooses from fixed categories and relationships. Your explicit kind stays in place, and relationships never merge or delete your notes.",
    },
    {
      role: "generation" as const,
      title: "Pick up the thread",
      icon: FileText,
      description:
        "Turns saved notes into readable titles, tags, project overviews, and task handoffs. Summaries link back to the exact memories they use.",
      detail:
        "MiniMax reads a bounded selection of current, scoped memories. Edits invalidate the old summary and schedule a replacement in the background.",
    },
  ];
  return (
    <div className="provider-overview">
      <p className="provider-intro">
        {settings.edition === "cloud"
          ? "Grove Cloud manages these providers for your account."
          : "Your installation administrator manages these providers."}{" "}
        You use the results in search, your memory library, and project context.
      </p>
      <div className="provider-roles">
        {roles.map(({ role, title, icon: Icon, description, detail }) => (
          <section key={role}>
            <Icon size={21} strokeWidth={1.5} />
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="provider-name">
                {settings.config[role].provider === "disabled"
                  ? "Not enabled"
                  : settings.config[role].model}
              </span>
              <details>
                <summary>How this works</summary>
                <p>
                  {settings.edition === "cloud"
                    ? detail
                    : `The configured ${role} provider processes this role using ${settings.config[role].model || "your administrator’s selected model"}.`}
                </p>
              </details>
            </div>
          </section>
        ))}
      </div>
      <div className="provider-workflow">
        <h2>From a note to useful context</h2>
        <ol>
          <li>
            <strong>Save it.</strong> Write a memory or let a connected agent
            capture one.
          </li>
          <li>
            <strong>Give it a home.</strong> Choose Personal or a project.
            Organization runs in the background.
          </li>
          <li>
            <strong>Use it again.</strong> Search naturally, read an overview,
            or open a handoff by title.
          </li>
        </ol>
        <p>
          Your original notes stay editable. Summaries are derived from them;
          the source links let you check the details.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className="app-button secondary" href="/app">
            Open memories
          </Link>
          <Link className="app-button secondary" href="/app/projects">
            Open projects
          </Link>
        </div>
      </div>
      <details className="agent-details">
        <summary>Technical details</summary>
        <p>
          Provider credentials stay on the server. Query/document text is sent
          to the configured search provider; classification and summaries use
          scoped source text.
        </p>
        <dl>
          {roles.map(({ role }) => (
            <div key={role}>
              <dt>{role}</dt>
              <dd>
                {settings.config[role].model || "Disabled"}
                {role === "embedding" &&
                settings.config.embedding.provider !== "disabled"
                  ? ` · ${settings.config.embedding.dimensions.toLocaleString()} dimensions`
                  : ""}
                <br />
                {settings.profiles[role] ?? "No active profile"}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
