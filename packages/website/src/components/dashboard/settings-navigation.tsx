"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceCache } from "./workspace-cache";
import { usePreferenceEditor } from "./preference-editor";

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
  return (
    <nav className="settings-navigation" aria-label="Settings sections">
      {[
        ...sections,
        ...(billing ? [["/app/settings/billing", "Billing"]] : []),
        ...(systemAdmin ? [["/app/settings/admin", "Admin"]] : []),
      ].map(([href, label]) => (
        <Link
          key={href}
          href={href}
          scroll={false}
          onClick={() =>
            document.querySelector(".settings-page")?.scrollTo(0, 0)
          }
          aria-current={
            path === href ||
            (href === "/app/settings/models" && path.startsWith(`${href}/`)) ||
            (href.endsWith("connections") && path === "/app/connections")
              ? "page"
              : undefined
          }
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
      ))}
      {dirty && (
        <span id="settings-draft-hint" className="sr-only">
          Unsaved preference changes
        </span>
      )}
    </nav>
  );
}
