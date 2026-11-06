import { Markdown } from "./markdown";
import { diffDocumentText } from "@lib/shared/document-diff";

/** Exact source changes first; complete rendered versions remain available for context. */
export function RevisionCompare({
  before,
  after,
  beforeLabel = "Earlier version",
  afterLabel = "Current version",
  media,
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  media?: { noteId: string; beforeVersion: number; afterVersion: number };
}) {
  const diff =
    before.length <= 6000 &&
    after.length <= 6000 &&
    !/[\uD800-\uDFFF]/u.test(before) &&
    !/[\uD800-\uDFFF]/u.test(after)
      ? diffDocumentText(before, after)
      : undefined;
  return (
    <div className="revision-review">
      <div className="revision-diff-heading">
        <strong>Changes</strong>
        <span>
          {beforeLabel} → {afterLabel}
        </span>
      </div>
      {before === after ? (
        <p>No changes to note text.</p>
      ) : diff ? (
        <>
          <p className="revision-diff-legend">
            <del>Removed</del>
            <ins>Added</ins>
            {diff.mode === "bounded" ? (
              <span>Showing grouped source changes</span>
            ) : null}
          </p>
          <div
            className="revision-diff"
            role="region"
            aria-label="Note text changes"
            tabIndex={0}
          >
            {diff.parts.map((part, index) =>
              part.type === "delete" ? (
                <del key={index}>{part.text}</del>
              ) : part.type === "insert" ? (
                <ins key={index}>{part.text}</ins>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </div>
        </>
      ) : (
        <p>
          This draft cannot be compared as a saved note yet. Compare the full
          versions below.
        </p>
      )}
      <details className="revision-complete">
        <summary>Full versions</summary>
        <div className="revision-compare">
          <section>
            <h4>{beforeLabel}</h4>
            <Markdown
              media={
                media
                  ? { noteId: media.noteId, version: media.beforeVersion }
                  : undefined
              }
            >
              {before}
            </Markdown>
          </section>
          <section>
            <h4>{afterLabel}</h4>
            <Markdown
              media={
                media
                  ? { noteId: media.noteId, version: media.afterVersion }
                  : undefined
              }
            >
              {after}
            </Markdown>
          </section>
        </div>
      </details>
    </div>
  );
}
