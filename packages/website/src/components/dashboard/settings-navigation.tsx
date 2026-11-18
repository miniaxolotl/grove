"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceCache } from "./workspace-cache";
import { usePreferenceEditor } from "./preference-editor";
import { ActionMenu } from "./ui/action-menu";

const sections = [
  ["/app/settings", "Writing"],
  ["/app/settings/models", "AI & search"],
  ["/app/settings/account", "Account"],
  ["/app/settings/connections", "Connections"],
  ["/app/settings/data", "Your data"],
  ["/app/settings/files", "Files & storage"],
];
export function SettingsNavigation({ billing = false }: { billing?: boolean }) {
  const cache = useWorkspaceCache();
  const admin = useQuery({
    ...cache.resource<{ role: string }>("/admin"),
    refetchInterval: 60000,
  });
  const systemAdmin = admin.data?.role === "system_admin" && !admin.error;
  const { dirty } = usePreferenceEditor();
  const path = usePathname();
  const destinations = [
    ...sections,
    ...(billing ? [["/app/settings/billing", "Billing"]] : []),
    ...(systemAdmin ? [["/app/settings/admin", "Admin"]] : []),
  ];
  const active = destinations.find(
    ([href]) =>
      path === href ||
      (href === "/app/settings/models" && path.startsWith(`${href}/`)) ||
      (href === "/app/settings/connections" && path === "/app/connections"),
  );
  const links = destinations.map(([href, label]) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      onClick={() => document.querySelector(".settings-page")?.scrollTo(0, 0)}
      aria-current={active?.[0] === href ? "page" : undefined}
      aria-describedby={
        href === "/app/settings/models" && dirty
          ? "settings-draft-hint"
          : undefined
      }
    >
      {label}
      {href === "/app/settings/models" && (
        <span
          className="settings-draft-dot"
          data-dirty={dirty}
          aria-hidden="true"
        />
      )}
    </Link>
  ));
  return (
    <nav className="settings-navigation" aria-label="Settings sections">
      <div className="settings-section-links">{links}</div>
      <div className="settings-section-picker">
        <ActionMenu
          label={`Change settings section: ${active?.[1] ?? "Sections"}${dirty ? ". Unsaved AI preferences" : ""}`}
          visibleLabel={active?.[1] ?? "Sections"}
        >
          {links}
        </ActionMenu>
      </div>
      {dirty && (
        <span id="settings-draft-hint" className="sr-only">
          Unsaved preference changes
        </span>
      )}
    </nav>
  );
}
