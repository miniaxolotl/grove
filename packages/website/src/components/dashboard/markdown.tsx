"use client";
import { createContext, useContext, type ComponentProps } from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { Square, SquareCheck } from "lucide-react";

type SharedLinks = { root: string; origin: string; linkedNoteIds: string[] };
type MarkdownOptions = {
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
  img: function ImageLink({ src, alt }) {
    const { shared } = useContext(MarkdownContext);
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
          components={components}
        >
          {children}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
}
