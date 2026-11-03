import Link from "next/link";
import type { SummaryEvidence } from "@lib/shared/summaries";

export function SourceEvidence({ sources }: { sources: SummaryEvidence[] }) {
  return (
    <details className="connection-support">
      <summary>Sources</summary>
      <div className="connection-evidence">
        <section className="col-span-full">
          {sources.map((source, index) => (
            <figure key={`${source.id}:${source.version}:${index}`}>
              <figcaption>
                <Link
                  href={`/app/memories/${source.id}?revision=${source.version}`}
                >
                  Revision {source.version}
                </Link>
              </figcaption>
              <blockquote>{source.quote}</blockquote>
            </figure>
          ))}
        </section>
      </div>
    </details>
  );
}
