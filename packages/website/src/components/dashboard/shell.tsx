"use client";
import { useEffect, useRef } from "react";
import { RedirectToSignIn, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Folder,
  Archive,
  Settings,
  Plus,
  LockKeyhole,
  UserRound,
  MessageSquare,
  NotebookPen,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { NoteDraftsProvider } from "./note-drafts";
import { NotebooksProvider } from "./notebooks-provider";
import { NotebookExplorer } from "./notebook-explorer";
import { setAccountBoundary } from "@/lib/analytics";
import { TelemetryChoice } from "@/components/website-telemetry";
import { WorkspaceDrag } from "./memory-drag";
import { WorkspaceSearch, WorkspaceSearchButton } from "./workspace-search";

const links = [
  { href: "/app", name: "Notes", icon: BookOpen },
  { href: "/app/journal", name: "Journal", icon: NotebookPen },
  { href: "/app/ask", name: "Ask Grove", icon: MessageSquare },
  { href: "/app/projects", name: "Notebooks", icon: Folder },
  { href: "/app/archive", name: "Archive", icon: Archive },
  { href: "/app/profile", name: "About me", icon: UserRound },
  { href: "/app/settings", name: "Settings", icon: Settings },
];
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, isLoaded, isSignedIn } = useUser();
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const revealCurrent = () => {
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (link && nav.scrollWidth > nav.clientWidth)
        nav.scrollLeft =
          link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
    };
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    revealCurrent();
    return () => observer.disconnect();
  }, [path, isLoaded, isSignedIn]);
  useEffect(() => {
    if (isLoaded) setAccountBoundary(user?.id ?? null);
  }, [isLoaded, user?.id]);
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
      <div className="connect-shell" data-private>
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
          <TelemetryChoice />
          <Link href="/privacy">Your memories stay private</Link>
          <Link href="/app/settings/connections">Your connections</Link>
        </footer>
      </div>
    );
  return (
    <NoteDraftsProvider key={user?.id}>
      <NotebooksProvider>
        <WorkspaceDrag>
          <WorkspaceSearch>
            <div className="grove-app" data-private>
              <aside className="app-sidebar">
                <div className="app-sidebar-heading">
                  <Brand />
                  <div className="lg:hidden">
                    <UserButton />
                  </div>
                </div>
                <Link
                  className="app-button sidebar-create"
                  href={`/app/notes/new${path.startsWith("/app/projects/") ? `?notebook=${encodeURIComponent(path.split("/")[3])}` : path === "/app/journal" ? "?from=journal" : ""}`}
                >
                  <Plus size={16} />
                  Write a note
                </Link>
                <WorkspaceSearchButton />
                <nav
                  ref={navigation}
                  aria-label="Notebook navigation"
                  className="app-navigation"
                >
                  {links.map(({ href, name, icon: Icon }, index) => (
                    <Link
                      key={href}
                      href={href}
                      aria-current={
                        (
                          href === "/app"
                            ? path === href ||
                              path === "/app/graph" ||
                              path.startsWith("/app/notes/") ||
                              path.startsWith("/app/memories/")
                            : path.startsWith(href)
                        )
                          ? "page"
                          : undefined
                      }
                      className={`app-nav${index > 3 ? " app-nav-secondary" : ""}`}
                    >
                      <Icon size={17} strokeWidth={1.6} />
                      {name}
                    </Link>
                  ))}
                </nav>
                <NotebookExplorer />
                <div className="app-sidebar-footer">
                  <nav aria-label="Workspace settings">
                    {links.slice(4).map(({ href, name, icon: Icon }) => (
                      <Link
                        className="app-nav"
                        key={href}
                        href={href}
                        aria-current={
                          path.startsWith(href) ? "page" : undefined
                        }
                      >
                        <Icon size={16} />
                        {name}
                      </Link>
                    ))}
                  </nav>
                  <div className="sidebar-account">
                    <UserButton />
                    <span className="truncate text-xs">
                      {user?.firstName ?? "Your account"}
                    </span>
                  </div>
                </div>
              </aside>
              <div className="app-main">
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
                          ? path === href ||
                            path.startsWith("/app/memories/") ||
                            path.startsWith("/app/notes/")
                          : path.startsWith(href),
                      )?.name ?? "Personal workspace"}
                    </strong>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="app-private-label">
                      <LockKeyhole size={12} aria-hidden="true" /> Private
                      notebook
                    </span>
                  </div>
                </header>
                <main id="main" className="app-content" key={user?.id}>
                  {children}
                </main>
                <footer className="app-footer">
                  <span>Grove</span>
                  <nav aria-label="Workspace help and policies">
                    <TelemetryChoice />
                    <Link
                      href="/app/archive"
                      aria-current={
                        path === "/app/archive" ? "page" : undefined
                      }
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
          </WorkspaceSearch>
        </WorkspaceDrag>
      </NotebooksProvider>
    </NoteDraftsProvider>
  );
}
