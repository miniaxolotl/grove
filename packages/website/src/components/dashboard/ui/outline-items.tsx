import { useId, useState, type ReactNode } from "react";
import type { NoteHeading } from "@/lib/note-headings";

/** Shared presentation; private and public callers own URLs and copy behavior. */
export function OutlineItems({
  headings,
  active,
  jump,
  href,
  action,
}: {
  headings: NoteHeading[];
  active?: string;
  jump: (heading: NoteHeading) => void;
  href?: (heading: NoteHeading) => string;
  action?: (heading: NoteHeading, labelId: string) => ReactNode;
}) {
  const id = useId();
  const [visible, setVisible] = useState(100);
  const minLevel = Math.min(...headings.map((heading) => heading.level));
  return (
    <>
      <ul>
        {headings.slice(0, visible).map((heading) => {
          const labelId = `${id}-${heading.id}`;
          const props = {
            id: labelId,
            "aria-current":
              active === heading.id ? ("location" as const) : undefined,
            style: {
              paddingLeft: 8 + Math.min(heading.level - minLevel, 3) * 12,
            },
          };
          const label = (
            <>
              <span className="outline-level" aria-hidden="true">
                {heading.point ? "•" : `H${heading.level}`}
              </span>
              <span>{heading.title}</span>
            </>
          );
          return (
            <li key={heading.id}>
              {href ? (
                <a
                  {...props}
                  href={href(heading)}
                  onClick={(event) => {
                    if (
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey
                    ) {
                      event.preventDefault();
                      jump(heading);
                    }
                  }}
                >
                  {label}
                </a>
              ) : (
                <button {...props} type="button" onClick={() => jump(heading)}>
                  {label}
                </button>
              )}
              {action?.(heading, labelId)}
            </li>
          );
        })}
      </ul>
      {headings.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((count) => count + 100)}
        >
          More sections
        </button>
      )}
    </>
  );
}
