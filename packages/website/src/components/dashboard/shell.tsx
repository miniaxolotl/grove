"use client";
import { useEffect, useRef, useState } from "react";
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
  Settings,
  Plus,
  LockKeyhole,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { Brand, GroveMark } from "@/components/brand";
import { NoteDraftsProvider } from "./note-drafts";
import { eraseDeviceDrafts } from "@/lib/draft-recovery";
import {
  WorkspaceCacheProvider,
  noteListWarmup,
  useWorkspaceCache,
} from "./workspace-cache";
import { WorkspaceOpening } from "./workspace-opening";
import { NoteExportProvider } from "./note-export";
import {
  NotebooksProvider,
  useCurrentNotebook,
  useNotebooks,
} from "./notebooks-provider";
import { NotebookExplorer, useWideWorkspace } from "./notebook-explorer";
import { Dialog } from "./dialog";
import { setAccountBoundary } from "@/lib/analytics";
import { TelemetryChoice } from "@/components/website-telemetry";
import { WorkspaceDrag } from "./memory-drag";
import { NotebookOrganizer } from "./notebook-organizer";
import { WorkspaceSearch, WorkspaceSearchButton } from "./workspace-search";
import { ToastProvider } from "./toasts";
import { PreferenceEditor } from "./preference-editor";
import { UnsavedChangesProvider } from "./unsaved-changes";
import { WorkspaceLocation } from "./workspace-location";
import { WorkspacePlan } from "./account-plan";
import {
  WorkspaceCommands,
  CommandMenuButton,
  ShortcutHelpButton,
} from "./workspace-commands";

const workspaceLinks = [
  { href: "/app", name: "Notes", icon: BookOpen },
  { href: "/app/ask", name: "Ask Grove", icon: MessageSquare },
];
const settingsLink = {
  href: "/app/settings",
  name: "Settings",
  icon: Settings,
};
const links = [...workspaceLinks, settingsLink];

function WorkspaceNavLink({
  item,
  current,
}: {
  item: (typeof links)[number];
  current: string | undefined;
}) {
  const { href, name, icon: Icon } = item;
  const cache = useWorkspaceCache();
  return (
    <Link
      href={href}
      aria-current={href === current ? "page" : undefined}
      className="app-nav"
      {...(href === "/app" ? noteListWarmup(cache, "active") : {})}
    >
      <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
}

function SidebarSection({ children }: { children: string }) {
  return (
    <p className="sidebar-section" aria-hidden="true">
      {children}
    </p>
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
  const recoveryOwner = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded || !sessionLoaded) return;
    const previous = recoveryOwner.current;
    recoveryOwner.current = isSignedIn ? (user?.id ?? null) : null;
    if (previous && previous !== recoveryOwner.current) {
      void eraseDeviceDrafts(previous).catch(() => {});
    }
  }, [isLoaded, sessionLoaded, isSignedIn, user?.id]);
  useEffect(() => {
    if (isLoaded) setAccountBoundary(user?.id ?? null);
  }, [isLoaded, user?.id]);
  if (!isLoaded || !sessionLoaded) return <WorkspaceOpening path={path} />;
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
          {path.startsWith("/app/connect/browser/") ? (
            <WorkspaceCacheProvider
              key={`${user!.id}:${session.id}`}
              account={user!.id}
              sessionId={session.id}
            >
              <NotebooksProvider>{children}</NotebooksProvider>
            </WorkspaceCacheProvider>
          ) : (
            children
          )}
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
        <UnsavedChangesProvider>
          <WorkspaceLocation>
            <PreferenceEditor>
              <NoteDraftsProvider account={user!.id}>
                <NoteExportProvider>
                  <NotebooksProvider>
                    <WorkspaceCommands>
                      <WorkspaceDrag>
                        <WorkspaceSearch>
                          <div className="grove-app" data-private>
                            <WorkspaceSidebar
                              current={current}
                              name={user?.firstName ?? "Your account"}
                            />
                            <div className="app-main">
                              <header className="app-topbar">
                                <span className="app-breadcrumb">
                                  <span>Your Grove</span>
                                  <span aria-hidden="true">/</span>
                                  <strong>
                                    {path === "/app/graph"
                                      ? "Note graph"
                                      : path === "/app/archive"
                                        ? "Archive"
                                        : path === "/app/profile"
                                          ? "About you"
                                          : (links.find(
                                              ({ href }) => href === current,
                                            )?.name ?? "Your notes")}
                                  </strong>
                                </span>
                                <div className="flex items-center gap-3">
                                  <span className="app-private-label">
                                    <LockKeyhole size={12} aria-hidden="true" />{" "}
                                    Private
                                  </span>
                                </div>
                              </header>
                              <main
                                id="main"
                                className="app-content"
                                key={user?.id}
                              >
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
                          <NotebookOrganizer />
                        </WorkspaceSearch>
                      </WorkspaceDrag>
                    </WorkspaceCommands>
                  </NotebooksProvider>
                </NoteExportProvider>
              </NoteDraftsProvider>
            </PreferenceEditor>
          </WorkspaceLocation>
        </UnsavedChangesProvider>
      </ToastProvider>
    </WorkspaceCacheProvider>
  );
}

function WorkspaceSidebar({
  current,
  name,
}: {
  current: string | undefined;
  name: string;
}) {
  const wide = useWideWorkspace();
  const path = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = !wide && openPath === path;
  const notebook = useCurrentNotebook();
  const { projects } = useNotebooks();
  const scope = notebook
    ? (projects.find((item) => item.id === notebook)?.name ?? "Notebook")
    : notebook === null
      ? "Unfiled"
      : current === "/app/ask"
        ? "Ask Grove"
        : current === "/app/settings"
          ? "Settings"
          : "Notes";
  const navigation = (
    <div
      className="workspace-navigation-body"
      onClickCapture={(event) => {
        if (
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          (event.target as Element).closest("a[href]:not([download])")
        )
          setOpenPath(null);
      }}
    >
      <div className="workspace-utilities">
        <CommandMenuButton />
        <ShortcutHelpButton compact />
      </div>
      <nav aria-label="Workspace" className="app-navigation">
        <SidebarSection>Workspace</SidebarSection>
        {workspaceLinks.map((item) => (
          <WorkspaceNavLink key={item.href} item={item} current={current} />
        ))}
      </nav>
      <NotebookExplorer expanded={!wide} />
      <div className="app-sidebar-footer">
        <div className="sidebar-account-avatar">
          <UserButton />
        </div>
        <span className="sidebar-account-text">
          <strong>{name}</strong>
          <small>Private Grove</small>
        </span>
        <WorkspacePlan />
      </div>
      <nav aria-label="Account settings" className="app-settings-navigation">
        <WorkspaceNavLink item={settingsLink} current={current} />
      </nav>
    </div>
  );
  return (
    <aside className="app-sidebar" aria-label="Workspace sidebar">
      <div className="app-sidebar-heading">
        <Brand href="/app" />
        <button
          type="button"
          className="workspace-mobile-toggle"
          aria-label={`Grove navigation: ${scope}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpenPath(path)}
        >
          <GroveMark className="size-5" />
          <span>{scope}</span>
          <ChevronDown size={14} />
        </button>
        <div className="workspace-header-actions">
          <NewNoteLink />
          <WorkspaceSearchButton />
        </div>
      </div>
      {wide ? (
        navigation
      ) : open ? (
        <Dialog
          title="Grove navigation"
          close={() => setOpenPath(null)}
          header={
            <h2 tabIndex={-1} data-autofocus>
              Your Grove
            </h2>
          }
        >
          <div className="workspace-mobile-navigation">{navigation}</div>
        </Dialog>
      ) : null}
    </aside>
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
