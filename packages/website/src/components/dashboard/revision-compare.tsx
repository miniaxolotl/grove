import { Markdown } from "./markdown";

/** Show both complete texts so prose and formatting remain reviewable without a lossy diff. */
export function RevisionCompare({
  before,
  after,
  beforeLabel = "Earlier version",
  afterLabel = "Current version",
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  return (
    <div className="revision-compare">
      <section>
        <h4>{beforeLabel}</h4>
        <Markdown>{before}</Markdown>
      </section>
      <section>
        <h4>{afterLabel}</h4>
        <Markdown>{after}</Markdown>
      </section>
    </div>
  );
}
