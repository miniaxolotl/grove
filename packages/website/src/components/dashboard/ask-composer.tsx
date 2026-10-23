"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Bold,
  Code,
  Eye,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Square,
  Strikethrough,
  Type,
} from "lucide-react";
import { Markdown } from "./markdown";

export function AskComposer({
  value,
  onChange,
  onSend,
  onStop,
  pending,
  disabled = false,
  tools,
  sendDisabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (format: "plain" | "markdown") => void;
  onStop: () => void;
  pending: boolean;
  disabled?: boolean;
  tools?: ReactNode;
  sendDisabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: value.length, end: value.length });
  const [formatted, setFormatted] = useState(false);
  const [preview, setPreview] = useState(false);
  const [limit, setLimit] = useState(false);
  useLayoutEffect(() => {
    const element = input.current!;
    const grow = () => {
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    };
    grow();
    // Observe the container's width, not the textarea's changing height.
    let width = element.parentElement!.clientWidth;
    const resize = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        grow();
      }
    });
    resize.observe(element.parentElement!);
    return () => resize.disconnect();
  }, [value, formatted, preview]);
  useEffect(() => {
    if (!disabled) input.current?.focus();
  }, [disabled]);
  function focus() {
    const { start, end } = selection.current;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start, end);
    });
  }
  function rememberSelection() {
    if (input.current && !preview)
      selection.current = {
        start: input.current.selectionStart,
        end: input.current.selectionEnd,
      };
  }
  function format(before: string, after = before, line = false) {
    const element = input.current!;
    rememberSelection();
    const { start, end } = selection.current;
    const from = line ? value.lastIndexOf("\n", start - 1) + 1 : start;
    const selected = value.slice(from, end);
    const insert = line
      ? selected
          .split("\n")
          .map(
            (text, index) =>
              `${before === "1. " ? `${index + 1}. ` : before}${text}`,
          )
          .join("\n")
      : `${before}${selected}${after}`;
    if (value.length - (end - from) + insert.length > 6000) {
      setLimit(true);
      return;
    }
    setPreview(false);
    element.focus();
    element.setSelectionRange(from, end);
    // Native insertion retains the textarea's platform undo/redo stack.
    if (!document.execCommand("insertText", false, insert)) {
      element.setRangeText(insert, from, end, "end");
    }
    onChange(element.value);
    selection.current = {
      start: from + before.length,
      end: line ? from + insert.length : from + before.length + selected.length,
    };
    focus();
  }
  return (
    <form
      className={`ask-composer${formatted ? " is-formatted" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !disabled && !sendDisabled && value.trim()) {
          setPreview(false);
          onSend(formatted ? "markdown" : "plain");
        }
      }}
    >
      {formatted && (
        <div
          className="ask-formatting"
          role="group"
          aria-label="Message formatting"
        >
          {(
            [
              ["Bold", Bold, "**", "**", false],
              ["Italic", Italic, "_", "_", false],
              ["Strikethrough", Strikethrough, "~~", "~~", false],
              ["Link", Link, "[", "](https://)", false],
              ["Bullet list", List, "- ", "", true],
              ["Numbered list", ListOrdered, "1. ", "", true],
              ["Quote", Quote, "> ", "", true],
              ["Code", Code, "`", "`", false],
            ] as const
          ).map(([label, Icon, before, after, line]) => (
            <button
              type="button"
              className="app-icon"
              key={label}
              aria-label={label}
              title={label}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(before, after, line)}
            >
              <Icon size={15} />
            </button>
          ))}
          <button
            type="button"
            className="app-icon ask-preview-toggle"
            aria-label="Preview message"
            title="Preview message"
            aria-pressed={preview}
            onClick={() => {
              rememberSelection();
              setPreview(!preview);
              if (preview) focus();
            }}
          >
            <Eye size={15} />
          </button>
        </div>
      )}
      <label className="sr-only" htmlFor={id}>
        Ask about your notes
      </label>
      <textarea
        ref={input}
        id={id}
        value={value}
        rows={1}
        maxLength={6000}
        disabled={disabled}
        hidden={preview}
        placeholder="Ask, research, or organize…"
        aria-describedby={`${id}-hint`}
        onSelect={(event) => {
          selection.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
        }}
        onBlur={rememberSelection}
        onChange={(event) => {
          setLimit(false);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            formatted &&
            (event.metaKey || event.ctrlKey) &&
            ["b", "i"].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
            format(event.key.toLowerCase() === "b" ? "**" : "_");
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            (event.metaKey ||
              event.ctrlKey ||
              (!formatted && !window.matchMedia("(pointer: coarse)").matches))
          ) {
            event.preventDefault();
            if (!pending) event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {preview && (
        <div className="ask-message-preview" aria-label="Message preview">
          <Markdown>{value || "Your message preview"}</Markdown>
        </div>
      )}
      <div className="ask-composer-footer">
        {tools}
        <button
          type="button"
          className="app-icon ask-format-toggle"
          aria-label="Markdown input"
          title={formatted ? "Switch to plain text" : "Show formatting"}
          aria-pressed={formatted}
          aria-expanded={formatted}
          onClick={() => {
            rememberSelection();
            setFormatted(!formatted);
            setPreview(false);
            focus();
          }}
        >
          <Type size={18} />
        </button>
        <span id={`${id}-hint`}>
          {formatted
            ? "Markdown · ⌘ / Ctrl ↵ to send"
            : "Shift ↵ for a new line"}
        </span>
        {value.length > 5400 && (
          <small>{value.length.toLocaleString()} / 6,000</small>
        )}
        {pending ? (
          <button
            type="button"
            className="ask-send"
            aria-label="Stop answer"
            onClick={onStop}
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            className="ask-send"
            aria-label="Send question"
            disabled={disabled || sendDisabled || !value.trim()}
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      {limit && (
        <p className="app-error" role="alert">
          Message is full. Shorten it before adding formatting.
        </p>
      )}
    </form>
  );
}
