"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Square, SquareCheck } from "lucide-react";

export function Markdown({
  children,
  shared,
}: {
  children: string;
  shared?: { root: string; origin: string; linkedNoteIds: string[] };
}) {
  const link = (href?: string) => {
    if (!href || !shared) return href;
    try {
      const url = new URL(href, shared.origin);
      if (url.origin === shared.origin && /^\/app(?:\/|$)/.test(url.pathname)) {
        const id = url.pathname
          .match(/^\/app\/memories\/([0-9a-f-]+)(?:\/edit)?$/i)?.[1]
          ?.toLowerCase();
        return id && shared.linkedNoteIds.includes(id)
          ? `${shared.root}/notes/${id}`
          : undefined;
      }
      return href;
    } catch {
      return undefined;
    }
  };
  return (
    <div className="memory-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            link(href) ? (
              <a
                href={link(href)}
                rel={shared ? "noreferrer noopener nofollow" : undefined}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          input: ({ checked }) => (
            <span
              className="markdown-task"
              role="img"
              aria-label={checked ? "Completed" : "Not completed"}
            >
              {checked ? <SquareCheck size={17} /> : <Square size={17} />}
            </span>
          ),
          h1: ({ children }) =>
            shared ? <h2>{children}</h2> : <h3>{children}</h3>,
          h2: ({ children }) =>
            shared ? <h3>{children}</h3> : <h4>{children}</h4>,
          h3: ({ children }) =>
            shared ? <h4>{children}</h4> : <h5>{children}</h5>,
          // Notes do not make third-party image requests just by being opened.
          img: ({ src, alt }) =>
            typeof src === "string" && link(src) ? (
              <a
                href={link(src)}
                rel={shared ? "noreferrer noopener nofollow" : undefined}
              >
                Image: {alt || "Open image"}
              </a>
            ) : null,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
