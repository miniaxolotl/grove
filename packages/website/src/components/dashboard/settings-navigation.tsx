"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  ["/app/settings", "Preferences"],
  ["/app/settings/account", "Account"],
  ["/app/settings/connections", "Connections"],
  ["/app/settings/models", "Search & organization"],
  ["/app/settings/data", "Your data"],
];
export function SettingsNavigation() {
  const path = usePathname();
  return (
    <nav className="settings-navigation" aria-label="Settings sections">
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
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
