import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FileText,
  Folder,
} from "lucide-react";
import type { PublicShare } from "@lib/shared/sharing";
import { site } from "@/lib/site";
import { Markdown } from "@/components/dashboard/markdown";
import { noteHeadings } from "@/lib/note-headings";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function PublicReader({
  data,
  token,
  path,
}: {
  data: PublicShare;
  token: string;
  path: string;
}) {
  const root = `/s/${token}`;
  const title = data.note?.title || data.notebook?.name || data.root.name;
  const heading = data.note?.content.match(/^\s*#{1,6}\s+([^\n]*)(?:\n|$)/);
  // Only remove an exact duplicate. The summary title may be truncated, while
  // the reader must retain every character of the saved heading.
  const removedTitleLength =
    data.note && heading && heading[1] === data.note.title
      ? heading[0].length
      : 0;
  const content = data.note?.content.slice(removedTitleLength) ?? "";
  // Generate IDs before hiding the repeated title so duplicate-section suffixes
  // still match authenticated links, then map offsets into the displayed body.
  const headings = noteHeadings(data.note?.content ?? "");
  const titleHeading = headings.find((item) => item.from < removedTitleLength);
  const bodyHeadings = headings
    .filter((item) => item.from >= removedTitleLength)
    .map((item) => ({ ...item, from: item.from - removedTitleLength }));
  return (
    <article className="shared-reader" data-shared-content data-private>
      {path !== root && data.kind === "notebook" && (
        <a className="shared-back" href={root}>
          <ArrowLeft size={16} aria-hidden="true" />
          {data.root.name}
        </a>
      )}
      <header className="shared-heading">
        <h1 id={titleHeading?.id}>{title || "Untitled note"}</h1>
        {data.note && (
          <p className="shared-date">
            Updated{" "}
            <time dateTime={data.note.updatedAt}>
              {dateFormat.format(new Date(data.note.updatedAt))}
            </time>
          </p>
        )}
      </header>
      {data.note ? (
        <Markdown
          headings={bodyHeadings}
          shared={{
            root,
            origin: site.url,
            linkedNoteIds: data.note.linkedNoteIds,
          }}
        >
          {content}
        </Markdown>
      ) : (
        <>
          {!!data.notebooks.length && (
            <nav className="shared-notebooks" aria-label="Sub-notebooks">
              <h2>Notebooks</h2>
              <ul>
                {data.notebooks.map((notebook) => (
                  <li key={notebook.id}>
                    <a href={`${root}/notebooks/${notebook.id}`}>
                      <Folder size={17} aria-hidden="true" />
                      <span>{notebook.name}</span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <section className="shared-notes" aria-label="Notes">
            <h2>Notes</h2>
            {data.notes.length ? (
              <ul>
                {data.notes.map((note) => (
                  <li key={note.id}>
                    <a href={`${root}/notes/${note.id}`}>
                      <FileText size={17} aria-hidden="true" />
                      <span className="shared-note-label">
                        <span>{note.title || "Untitled note"}</span>
                        <time dateTime={note.updatedAt}>
                          Updated {dateFormat.format(new Date(note.updatedAt))}
                        </time>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="shared-empty">
                No notes to read in this notebook yet.
              </p>
            )}
          </section>
          {data.nextCursor && (
            <a
              className="shared-next"
              href={`${path}?cursor=${encodeURIComponent(data.nextCursor)}`}
            >
              More notes <ArrowRight size={16} aria-hidden="true" />
            </a>
          )}
        </>
      )}
    </article>
  );
}
