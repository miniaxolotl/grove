"use client";
import { useEffect } from "react";
import {
  RedirectToSignIn,
  UserButton,
  useUser,
  useSession,
} from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Archive,
  Settings,
  Plus,
  LockKeyhole,
  MessageSquare,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { NoteDraftsProvider } from "./note-drafts";
import { WorkspaceCacheProvider } from "./workspace-cache";
import { NoteExportProvider } from "./note-export";
import { NotebooksProvider, useCurrentNotebook } from "./notebooks-provider";
import { NotebookExplorer } from "./notebook-explorer";
import { setAccountBoundary } from "@/lib/analytics";
import { TelemetryChoice } from "@/components/website-telemetry";
import { WorkspaceDrag } from "./memory-drag";
import { WorkspaceSearch, WorkspaceSearchButton } from "./workspace-search";
import { ToastProvider } from "./toasts";
import { WorkspacePlan } from "./account-plan";
import {
  WorkspaceCommands,
  CommandMenuButton,
  ShortcutHelpButton,
} from "./workspace-commands";

const links = [
  { href: "/app", name: "Notes", icon: BookOpen },
  { href: "/app/ask", name: "Ask Grove", icon: MessageSquare },
  { href: "/app/archive", name: "Archive", icon: Archive },
  { href: "/app/settings", name: "Settings", icon: Settings },
];

function WorkspaceNavLink({
  item,
  current,
  secondary = false,
}: {
  item: (typeof links)[number];
  current: string | undefined;
  secondary?: boolean;
}) {
  const { href, name, icon: Icon } = item;
  return (
    <Link
      href={href}
      aria-current={href === current ? "page" : undefined}
      className={`app-nav${secondary ? " app-nav-secondary" : ""}`}
    >
      <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const current = /^\/app\/(?:memories|notes|projects|graph)(?:\/|$)/.test(path)
    ? "/app"
    : links.find(
        ({ href }) =>
          path === href || (href !== "/app" && path.startsWith(`${href}/`)),
      )?.href;
  const { user, isLoaded, isSignedIn } = useUser();
  const { session, isLoaded: sessionLoaded } = useSession();
  useEffect(() => {
    if (isLoaded) setAccountBoundary(user?.id ?? null);
  }, [isLoaded, user?.id]);
  if (!isLoaded || !sessionLoaded)
    return (
      <main id="main" className="app-opening">
        <Brand />
        <p role="status">Opening your Grove…</p>
      </main>
    );
  if (!isSignedIn || !session) return <RedirectToSignIn />;
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
    <WorkspaceCacheProvider
      key={`${user!.id}:${session.id}`}
      account={user!.id}
      sessionId={session.id}
    >
      <ToastProvider>
        <NoteDraftsProvider>
          <NoteExportProvider>
            <NotebooksProvider>
              <WorkspaceCommands>
                <WorkspaceDrag>
                  <WorkspaceSearch>
                    <div className="grove-app" data-private>
                      <aside
                        className="app-sidebar"
                        aria-label="Workspace sidebar"
                      >
                        <div className="app-sidebar-heading">
                          <Brand href="/app" />
                          <NewNoteLink />
                          <WorkspaceSearchButton />
                          <div className="lg:hidden">
                            <UserButton />
                          </div>
                        </div>
                        <div className="workspace-utilities">
                          <CommandMenuButton />
                          <WorkspacePlan />
                          <ShortcutHelpButton compact />
                        </div>
                        <nav
                          aria-label="Notebook navigation"
                          className="app-navigation"
                        >
                          {links.map((item, index) => (
                            <WorkspaceNavLink
                              key={item.href}
                              item={item}
                              current={current}
                              secondary={index > 1}
                            />
                          ))}
                        </nav>
                        <NotebookExplorer />
                        <div className="app-sidebar-footer">
                          <nav aria-label="Workspace settings">
                            {links.slice(2).map((item) => (
                              <WorkspaceNavLink
                                key={item.href}
                                item={item}
                                current={current}
                              />
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
                              {path === "/app/graph"
                                ? "Note graph"
                                : path === "/app/profile"
                                  ? "About you"
                                  : (links.find(({ href }) => href === current)
                                      ?.name ?? "Your notes")}
                            </strong>
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="app-private-label">
                              <LockKeyhole size={12} aria-hidden="true" />{" "}
                              Private
                            </span>
                          </div>
                        </header>
                        <main id="main" className="app-content" key={user?.id}>
                          {children}
                        </main>
                        <footer className="app-footer">
                          <span>Grove</span>
                          <nav aria-label="Workspace help and policies">
                            <ShortcutHelpButton />
                            <TelemetryChoice />
                            <Link href="/install">Setup guide</Link>
                            <Link href="/privacy">Privacy</Link>
                            <Link href="/terms">Terms</Link>
                            <Link href="/support">Get help</Link>
                          </nav>
                        </footer>
                      </div>
                    </div>
                  </WorkspaceSearch>
                </WorkspaceDrag>
              </WorkspaceCommands>
            </NotebooksProvider>
          </NoteExportProvider>
        </NoteDraftsProvider>
      </ToastProvider>
    </WorkspaceCacheProvider>
  );
}

function NewNoteLink() {
  const notebook = useCurrentNotebook();
  return (
    <Link
      className="app-button sidebar-create"
      href={`/app/notes/new${notebook ? `?notebook=${encodeURIComponent(notebook)}` : ""}`}
    >
      <Plus size={16} /> <span>New note</span>
    </Link>
  );
}
