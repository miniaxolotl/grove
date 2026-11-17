import { Brand } from "@/components/brand";
import { PageHeading } from "./ui/page-heading";

export function LibrarySkeleton({ archive = false }: { archive?: boolean }) {
  return (
    <div className="library-list library-skeleton">
      <p className="library-skeleton-status" role="status">
        {archive ? "Opening your archive…" : "Opening your notes…"}
      </p>
      <div aria-hidden="true">
        <div className="library-selection-header">
          <i className="workspace-bone skeleton-check" />
        </div>
        {Array.from({ length: 5 }, (_, index) => (
          <div className="memory-list-item" key={index}>
            <div className="memory-row">
              <i className="workspace-bone skeleton-check" />
              <div className="skeleton-row-copy">
                <i className="workspace-bone" />
                <i className="workspace-bone" />
                <i className="workspace-bone" />
              </div>
              <i className="workspace-bone skeleton-check" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DocumentSkeleton({
  label = "Opening your note…",
}: {
  label?: string;
}) {
  return (
    <div className="document-skeleton">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div className="document-skeleton-bar" aria-hidden="true">
        <i className="workspace-bone" />
      </div>
      <div className="document-skeleton-paper" aria-hidden="true">
        <i className="workspace-bone" />
        <i className="workspace-bone" />
        <i className="workspace-bone" />
        <i className="workspace-bone" />
      </div>
    </div>
  );
}

export function WorkspaceRouteSkeleton({ path }: { path: string }) {
  if (path.startsWith("/app/memories/") || path === "/app/notes/new")
    return (
      <div className="note-document">
        <DocumentSkeleton />
      </div>
    );
  const archive = path === "/app/archive";
  const list = path === "/app" || archive || path === "/app/journal";
  if (!list) return <DocumentSkeleton label="Opening your workspace…" />;
  return (
    <>
      <PageHeading
        title={archive ? "Archive" : "Notes"}
        actions={
          !archive && (
            <>
              <span
                className="app-button secondary skeleton-action"
                aria-hidden="true"
              >
                Import notes
              </span>
              <span
                className="app-button secondary skeleton-action"
                aria-hidden="true"
              >
                Today’s note
              </span>
            </>
          )
        }
      />
      <div className="workspace-bone skeleton-filter" aria-hidden="true" />
      <div
        className="library-caption skeleton-caption"
        data-archive={archive || undefined}
        aria-hidden="true"
      >
        <i className="workspace-bone" />
      </div>
      <LibrarySkeleton archive={archive} />
    </>
  );
}

/** Rendered after server authorization, before the browser session can fetch data. */
export function WorkspaceOpening({ path }: { path: string }) {
  if (path.startsWith("/app/connect/"))
    return (
      <div className="connect-shell">
        <div className="connect-topbar">
          <Brand />
        </div>
        <main id="main" className="connect-content">
          <DocumentSkeleton label="Opening your connection…" />
        </main>
      </div>
    );
  return (
    <div className="grove-app workspace-opening" data-private>
      <div className="app-sidebar" aria-hidden="true" inert>
        <div className="app-sidebar-heading">
          <Brand href="/app" />
          <i className="workspace-bone sidebar-create skeleton-create" />
          <i className="workspace-bone workspace-search-launcher skeleton-search" />
          <div className="sidebar-account-avatar workspace-bone lg:hidden" />
        </div>
        <div className="workspace-utilities">
          <i className="workspace-bone" />
        </div>
        <div className="app-navigation">
          {[0, 1, 2, 3].map((index) => (
            <div className="app-nav" key={index}>
              <i className="workspace-bone" />
            </div>
          ))}
        </div>
        <div className="workspace-bone skeleton-notebooks" />
      </div>
      <div className="app-main">
        <div className="app-topbar" aria-hidden="true">
          <i className="workspace-bone" />
        </div>
        <main id="main" className="app-content">
          <WorkspaceRouteSkeleton path={path} />
        </main>
      </div>
    </div>
  );
}
