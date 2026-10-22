"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { usePreferenceEditor } from "./preference-editor";

const sections = [
  ["/app/settings", "Preferences"],
  ["/app/settings/account", "Account"],
  ["/app/settings/connections", "Connections"],
  ["/app/settings/models", "AI & search"],
  ["/app/settings/data", "Your data"],
];
export function SettingsNavigation() {
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
      if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        nav.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [path]);
  return (
    <nav
      ref={navigation}
      className="settings-navigation"
      aria-label="Settings sections"
    >
      {sections.map(([href, label]) => (
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
