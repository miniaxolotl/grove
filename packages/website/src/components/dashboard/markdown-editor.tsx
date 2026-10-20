"use client";
import { useId, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListChecks,
  Code,
  Link as LinkIcon,
} from "lucide-react";
import { Markdown } from "./markdown";

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const history = useRef({
    entries: [{ value, start: value.length, end: value.length }],
    index: 0,
  });
  function change(next: string, start: number, end: number) {
    if (next === value || next.length > 6000) return;
    const state = history.current;
    state.entries = [
      ...state.entries.slice(0, state.index + 1),
      { value: next, start, end },
    ].slice(-100);
    state.index = state.entries.length - 1;
    onChange(next);
  }
  function undo(redo: boolean) {
    const state = history.current;
    const index = state.index + (redo ? 1 : -1);
    const entry = state.entries[index];
    if (!entry) return;
    state.index = index;
    onChange(entry.value);
    requestAnimationFrame(() =>
      field.current?.setSelectionRange(entry.start, entry.end),
    );
  }
  function format(
    before: string,
    after = "",
    fallback = "text",
    lines = false,
  ) {
    const input = field.current;
    if (!input) return;
    const start = lines
      ? value.lastIndexOf("\n", Math.max(0, input.selectionStart - 1)) + 1
      : input.selectionStart;
    const lineEnd = value.indexOf("\n", input.selectionEnd);
    const end = lines
      ? lineEnd === -1
        ? value.length
        : lineEnd
      : input.selectionEnd;
    const selected = value.slice(start, end) || fallback;
    const text = lines
      ? selected
          .split("\n")
          .map((line) => before + line)
          .join("\n")
      : before + selected + after;
    const next = value.slice(0, start) + text + value.slice(end);
    if (next.length > 6000) return;
    history.current.entries[history.current.index] = {
      value,
      start: input.selectionStart,
      end: input.selectionEnd,
    };
    change(next, start + before.length, start + text.length - after.length);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(
        start + before.length,
        start + text.length - after.length,
      );
    });
  }
  return (
    <div className="markdown-editor">
      <div className="editor-heading">
        <label htmlFor={id}>What should stay with you?</label>
        <div className="segmented-control" aria-label="Editor mode">
          <button
            type="button"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
        </div>
      </div>
      <div className="editor-surface">
        <div
          className="editor-tools"
          role="group"
          aria-label="Markdown formatting"
        >
          {[
            { name: "Bold", icon: Bold, before: "**", after: "**" },
            { name: "Italic", icon: Italic, before: "_", after: "_" },
            { name: "Heading", icon: Heading2, before: "## ", lines: true },
            { name: "Bullet list", icon: List, before: "- ", lines: true },
            {
              name: "Checklist",
              icon: ListChecks,
              before: "- [ ] ",
              lines: true,
            },
            { name: "Code", icon: Code, before: "`", after: "`" },
            {
              name: "Link",
              icon: LinkIcon,
              before: "[",
              after: "](https://example.com)",
            },
          ].map(({ name, icon: Icon, before, after, lines }) => (
            <button
              key={name}
              type="button"
              className="app-icon"
              aria-label={name}
              title={name}
              disabled={preview}
              onClick={() =>
                format(
                  before,
                  after,
                  name === "Heading" ? "Heading" : "text",
                  lines,
                )
              }
            >
              <Icon size={16} />
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">Markdown</span>
        </div>
        {/* Keep the writing surface mounted so switching preview retains selection. */}
        <textarea
          id={id}
          ref={field}
          hidden={preview}
          rows={11}
          required
          value={value}
          maxLength={6000}
          autoFocus
          placeholder={placeholder}
          onChange={(e) =>
            change(
              e.target.value,
              e.target.selectionStart,
              e.target.selectionEnd,
            )
          }
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              ["z", "y"].includes(e.key.toLowerCase())
            ) {
              e.preventDefault();
              undo(e.shiftKey || e.key.toLowerCase() === "y");
              return;
            }
            if (
              (e.metaKey || e.ctrlKey) &&
              ["b", "i"].includes(e.key.toLowerCase())
            ) {
              e.preventDefault();
              const mark = e.key.toLowerCase() === "b" ? "**" : "_";
              format(mark, mark);
            }
          }}
        />
        {preview && (
          <div className="editor-preview" aria-label="Markdown preview">
            {value ? (
              <Markdown>{value}</Markdown>
            ) : (
              <p className="text-muted">
                Your formatted note will appear here.
              </p>
            )}
          </div>
        )}
        <div className="editor-footer">
          <span>Headings, lists, links, and code</span>
          <span>{value.length.toLocaleString()} / 6,000</span>
        </div>
      </div>
    </div>
  );
}
