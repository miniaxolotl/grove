"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceCache } from "./workspace-cache";
import { usePreferenceEditor } from "./preference-editor";

const sections = [
  ["/app/settings", "Preferences"],
  ["/app/settings/account", "Account"],
  ["/app/settings/connections", "Connections"],
  ["/app/settings/models", "AI & search"],
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
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const reveal = () => {
      const bounds = nav.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      // Leave room for focus rings and browsers that round horizontal scrolling.
      if (item.left < bounds.left + 4)
        nav.scrollLeft -= Math.ceil(bounds.left + 4 - item.left);
      else if (item.right > bounds.right - 4)
        nav.scrollLeft += Math.ceil(item.right - bounds.right + 4);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    // Font loading can widen the links without resizing the navigation itself.
    nav.querySelectorAll("a").forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [path, billing, systemAdmin]);
  return (
    <nav
      ref={navigation}
      className="settings-navigation"
      aria-label="Settings sections"
    >
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
            (href.endsWith("connections") && path === "/app/connections")
              ? "page"
              : undefined
          }
          aria-describedby={
            href === "/app/settings" && dirty
              ? "settings-draft-hint"
              : undefined
          }
        >
          {label}
          {href === "/app/settings" && (
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
