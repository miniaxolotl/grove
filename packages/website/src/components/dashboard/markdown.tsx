"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Square, SquareCheck } from "lucide-react";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="memory-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            href ? <a href={href}>{children}</a> : <span>{children}</span>,
          input: ({ checked }) => (
            <span
              className="markdown-task"
              role="img"
              aria-label={checked ? "Completed" : "Not completed"}
            >
              {checked ? <SquareCheck size={17} /> : <Square size={17} />}
            </span>
          ),
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h5>{children}</h5>,
          // Notes do not make third-party image requests just by being opened.
          img: ({ src, alt }) =>
            typeof src === "string" ? (
              <a href={src}>Image: {alt || "Open image"}</a>
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
