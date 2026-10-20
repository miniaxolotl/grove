"use client";
import { RedirectToSignIn, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Folder,
  Archive,
  Plug,
  Settings,
  ArrowUpRight,
  LockKeyhole,
  UserRound,
  MessageSquare,
  NotebookPen,
} from "lucide-react";
import { Brand } from "@/components/brand";

const links = [
  { href: "/app", name: "Notes", icon: BookOpen },
  { href: "/app/journal", name: "Journal", icon: NotebookPen },
  { href: "/app/ask", name: "Ask Grove", icon: MessageSquare },
  { href: "/app/projects", name: "Notebooks", icon: Folder },
  { href: "/app/profile", name: "About me", icon: UserRound },
  { href: "/app/connections", name: "Connections", icon: Plug },
  { href: "/app/settings", name: "Settings", icon: Settings },
];
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded)
    return (
      <main id="main" className="app-opening">
        <Brand />
        <p role="status">Opening your Grove…</p>
      </main>
    );
  if (!isSignedIn) return <RedirectToSignIn />;
  if (path.startsWith("/app/connect/"))
    return (
      <div className="connect-shell">
        <header className="connect-topbar">
          <Brand />
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>{user?.firstName ?? "Your account"}</span>
            <UserButton />
          </div>
        </header>
        <main id="main" className="connect-content" key={user?.id}>
          {children}
        </main>
        <footer className="app-footer">
          <Link href="/privacy">Your memories stay private</Link>
          <Link href="/app/connections">Your connections</Link>
        </footer>
      </div>
    );
  return (
    <div className="grove-app">
      <aside className="app-sidebar">
        <Brand />
        <p className="mt-9 px-3 text-[10px] font-semibold tracking-[0.15em] text-muted">
          YOUR NOTEBOOK
        </p>
        <nav
          aria-label="Notebook navigation"
          className="mt-3 flex gap-1 overflow-x-auto lg:flex-col"
        >
          {links.map(({ href, name, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                (
                  href === "/app"
                    ? path === href || path.startsWith("/app/memories/")
                    : path.startsWith(href)
                )
                  ? "page"
                  : undefined
              }
              className="app-nav"
            >
              <Icon size={17} strokeWidth={1.6} />
              {name}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden pt-12 lg:block">
          <div className="px-2">
            <Link
              href="/app/connections"
              className="inline-flex min-h-11 items-center gap-2 text-xs font-medium"
            >
              Connect your agents <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-3 px-2">
            <UserButton />
            <span className="truncate text-xs">
              {user?.firstName ?? "Your account"}
            </span>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="app-topbar">
          <span className="app-breadcrumb">
            <span>Your Grove</span>
            <span aria-hidden="true">/</span>
            <strong>
              {[
                ...links,
                { href: "/app/archive", name: "Archive" },
                { href: "/app/graph", name: "Note graph" },
              ].find(({ href }) =>
                href === "/app"
                  ? path === href || path.startsWith("/app/memories/")
                  : path.startsWith(href),
              )?.name ?? "Personal workspace"}
            </strong>
          </span>
          <div className="flex items-center gap-3">
            <span className="app-private-label">
              <LockKeyhole size={12} aria-hidden="true" /> Private notebook
            </span>
            <div className="lg:hidden">
              <UserButton />
            </div>
          </div>
        </header>
        <main id="main" className="app-content" key={user?.id}>
          {children}
        </main>
        <footer className="app-footer">
          <span>A little space for what matters.</span>
          <nav aria-label="Workspace help and policies">
            <Link
              href="/app/archive"
              aria-current={path === "/app/archive" ? "page" : undefined}
            >
              <Archive size={14} />
              Archive
            </Link>
            <Link href="/install">Setup guide</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:grove@mawa.dev">Get help</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
