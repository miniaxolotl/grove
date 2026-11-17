import { Brand } from "@/components/brand";
import { PageHeading } from "./ui/page-heading";

const skeletonTitleWidths = ["72%", "48%", "63%", "55%", "68%"];

export function LibrarySkeleton({
  archive = false,
  showExcerpt = false,
}: {
  archive?: boolean;
  showExcerpt?: boolean;
}) {
  return (
    <div className="library-list library-skeleton">
      <div className="library-selection-header">
        <div className="select-loaded">
          <i className="skeleton-check" aria-hidden="true" />
          <span role="status">
            {archive ? "Opening your archive…" : "Opening your notes…"}
          </span>
        </div>
      </div>
      <ul aria-hidden="true">
        {skeletonTitleWidths.map((width) => (
          <li className="memory-list-item" key={width}>
            <div className="memory-row">
              <div className="row-selection">
                <span className="row-checkbox">
                  <i className="skeleton-check" />
                </span>
                <span className="drag-handle" />
              </div>
              <div className="memory-row-content">
                <div className="skeleton-note-open">
                  <span className="memory-title">
                    <i className="workspace-bone" style={{ width }} />
                  </span>
                  {showExcerpt && (
                    <span className="memory-excerpt">
                      <i className="workspace-bone" />
                    </span>
                  )}
                </div>
                <div className="memory-row-details">
                  <div className="memory-meta">
                    <span>
                      <i className="workspace-bone" />
                    </span>
                    <span>
                      <i className="workspace-bone" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
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
          <span
            className="app-button secondary skeleton-action"
            aria-hidden="true"
          >
            {archive ? "Back to notes" : "More"}
          </span>
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
          <div className="workspace-header-actions">
            <i className="workspace-bone sidebar-create skeleton-create" />
            <i className="workspace-bone workspace-search-launcher skeleton-search" />
            <div className="sidebar-account-avatar workspace-bone lg:hidden" />
          </div>
        </div>
        <div className="workspace-utilities">
          <i className="workspace-bone" />
        </div>
        <div className="app-navigation">
          {[0, 1, 2].map((index) => (
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
