import { Markdown } from "./markdown";

/** Show both complete texts so prose and formatting remain reviewable without a lossy diff. */
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
  return (
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
  );
}
