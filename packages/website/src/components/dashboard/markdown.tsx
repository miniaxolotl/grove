"use client";
import {
  createContext,
  useContext,
  type ComponentProps,
  type DragEvent,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { Square, SquareCheck } from "lucide-react";
import { mediaReferenceId } from "@lib/shared/media";

type SharedLinks = { root: string; origin: string; linkedNoteIds: string[] };
type MarkdownOptions = {
  onImageDrag?: (
    event: DragEvent<HTMLImageElement>,
    from: number,
    to: number,
  ) => void;
  onImageMove?: (from: number, to: number, direction: "up" | "down") => void;
  media?: { noteId: string; version?: number };
  source: string;
  shared?: SharedLinks;
  onToggleTask?: (offset: number, checked: boolean) => void;
  disabled?: boolean;
};
const MarkdownContext = createContext<MarkdownOptions>({ source: "" });
const TaskContext = createContext<{ offset: number; label: string } | null>(
  null,
);
type MarkdownNode = NonNullable<ExtraProps["node"]>;

function textContent(
  node: MarkdownNode | MarkdownNode["children"][number],
): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(textContent).join("") : "";
}

function TaskItem({
  node,
  children,
  ...props
}: ComponentProps<"li"> & ExtraProps) {
  const { source } = useContext(MarkdownContext);
  const start = node?.position?.start.offset;
  // The parsed list item supplies the source boundary: fenced examples and
  // repeated/nested labels cannot accidentally target another checkbox.
  const marker =
    typeof start === "number" &&
    node?.properties.className?.toString().includes("task-list-item")
      ? /^(?:[-+*]|\d+[.)])\s+\[([ xX])\](?=\s|$)/.exec(source.slice(start))
      : null;
  const task =
    marker && typeof start === "number"
      ? {
          offset: start + marker[0].indexOf("[") + 1,
          label:
            node!.children
              .filter(
                (child) =>
                  child.type !== "element" ||
                  !["ul", "ol"].includes(child.tagName),
              )
              .map(textContent)
              .join("")
              .trim() || "Task",
        }
      : null;
  return (
    <li {...props}>
      <TaskContext.Provider value={task}>{children}</TaskContext.Provider>
    </li>
  );
}

function TaskCheckbox({ checked }: ComponentProps<"input">) {
  const { onToggleTask, disabled, shared } = useContext(MarkdownContext);
  const task = useContext(TaskContext);
  const icon = checked ? (
    <SquareCheck size={17} aria-hidden="true" />
  ) : (
    <Square size={17} aria-hidden="true" />
  );
  return task && onToggleTask && !shared ? (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={task.label}
      disabled={disabled}
      data-focus-key={`note-task-${task.offset}`}
      className="markdown-task markdown-task-toggle"
      onClick={() => onToggleTask(task.offset, !checked)}
    >
      {icon}
    </button>
  ) : (
    <span
      className="markdown-task"
      role="img"
      aria-label={checked ? "Completed" : "Not completed"}
    >
      {icon}
    </span>
  );
}

function sharedLink(href: string | undefined, shared: SharedLinks | undefined) {
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
}

// Stable renderer identities preserve the focused task control during autosave.
const components: Components = {
  p: ({ node, children }) => (
    <p
      data-source-from={node?.position?.start.offset}
      data-source-to={node?.position?.end.offset}
    >
      {children}
    </p>
  ),
  li: TaskItem,
  input: TaskCheckbox,
  a: function Link({ href, children }) {
    const { shared } = useContext(MarkdownContext);
    const target = sharedLink(href, shared);
    return target ? (
      <a
        href={target}
        rel={shared ? "noreferrer noopener nofollow" : undefined}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  h1: function Heading({ children }) {
    return useContext(MarkdownContext).shared ? (
      <h2>{children}</h2>
    ) : (
      <h3>{children}</h3>
    );
  },
  h2: function Heading({ children }) {
    return useContext(MarkdownContext).shared ? (
      <h2>{children}</h2>
    ) : (
      <h4>{children}</h4>
    );
  },
  h3: function Heading({ children }) {
    return useContext(MarkdownContext).shared ? (
      <h3>{children}</h3>
    ) : (
      <h5>{children}</h5>
    );
  },
  // Notes do not make third-party image requests just by being opened.
  img: function ImageLink({ src, alt, node }) {
    const { shared, media, onImageDrag, onImageMove } =
      useContext(MarkdownContext);
    const id = typeof src === "string" ? mediaReferenceId(src) : null;
    if (id) {
      if (!media) return <span>Image: {alt || "Attachment"}</span>;
      const url = shared
        ? `${shared.root}/notes/${media.noteId}/media/${id}`
        : `/api/grove/memories/${media.noteId}/media/${id}${media.version ? `?version=${media.version}` : ""}`;
      // Authenticated same-origin bytes must bypass the public Next image cache.
      const from = node?.position?.start.offset,
        to = node?.position?.end.offset;
      const movable =
        !shared &&
        onImageDrag &&
        typeof from === "number" &&
        typeof to === "number";
      return (
        <span className="owned-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={url}
            src={url}
            alt={alt || "Attached image"}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={!!movable}
            onDragStart={
              movable ? (event) => onImageDrag(event, from, to) : undefined
            }
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              height: "auto",
              objectFit: "contain",
            }}
          />
          {movable && onImageMove && (
            <span className="owned-image-actions">
              <button
                type="button"
                onClick={() => onImageMove(from, to, "up")}
                aria-label={`Move ${alt || "image"} up`}
              >
                Move up
              </button>
              <button
                type="button"
                onClick={() => onImageMove(from, to, "down")}
                aria-label={`Move ${alt || "image"} down`}
              >
                Move down
              </button>
            </span>
          )}
        </span>
      );
    }
    const target =
      typeof src === "string" ? sharedLink(src, shared) : undefined;
    return target ? (
      <a
        href={target}
        rel={shared ? "noreferrer noopener nofollow" : undefined}
      >
        Image: {alt || "Open image"}
      </a>
    ) : null;
  },
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
};

export function Markdown({
  children,
  ...options
}: Omit<MarkdownOptions, "source"> & { children: string }) {
  return (
    <MarkdownContext.Provider value={{ source: children, ...options }}>
      <div className="memory-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          urlTransform={(url) =>
            mediaReferenceId(url) ? url : defaultUrlTransform(url)
          }
          components={components}
        >
          {children}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
}
