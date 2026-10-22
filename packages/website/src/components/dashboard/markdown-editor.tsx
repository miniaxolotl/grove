"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  keymap,
  placeholder as editorPlaceholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  undo,
} from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListChecks,
  Code,
  Link as LinkIcon,
  Quote,
  Undo2,
  Redo2,
  ListTree,
  Eye,
  Pencil,
} from "lucide-react";
import { Markdown } from "./markdown";
import { liveMarkdown, prefixLines, wrapSelection } from "./markdown-surface";
import { SegmentedControl } from "./ui/segmented-control";
import { IconButton } from "./ui/button";

const highlighting = HighlightStyle.define([
  { tag: tags.heading, class: "cm-note-heading-text" },
  { tag: tags.strong, class: "cm-note-strong" },
  { tag: tags.emphasis, class: "cm-note-emphasis" },
  { tag: tags.monospace, class: "cm-note-code" },
  { tag: [tags.link, tags.url], class: "cm-note-link" },
  { tag: tags.processingInstruction, class: "cm-note-marker" },
  { tag: tags.strikethrough, class: "cm-note-strike" },
]);

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  fullPage = false,
  preview = false,
  onPreviewChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fullPage?: boolean;
  preview?: boolean;
  onPreviewChange?: (preview: boolean) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef({ preview: 0, edit: 0 });
  const view = useRef<EditorView | null>(null);
  const initial = useRef({ value, placeholder });
  const change = useRef(onChange);
  const compartments = useRef({
    mode: new Compartment(),
    editable: new Compartment(),
  });
  const [writingMode, setWritingMode] = useState<"live" | "source">("live");
  const mode = preview ? "preview" : writingMode;
  const [outline, setOutline] = useState(false);
  const limit = value.length > 6000;
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current.value,
        selection: { anchor: initial.current.value.length },
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, completeHTMLTags: false }),
          syntaxHighlighting(highlighting),
          compartments.current.mode.of(liveMarkdown),
          compartments.current.editable.of([]),
          editorPlaceholder(initial.current.placeholder ?? "Start writing…"),
          EditorView.contentAttributes.of({
            id,
            "aria-label": "What should stay with you?",
            "data-focus-key": "note-editor",
            "aria-describedby": `${id}-help`,
            spellcheck: "true",
            autocapitalize: "sentences",
          }),
          keymap.of([
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            { key: "Mod-b", run: (view) => wrapSelection(view, "**") },
            { key: "Mod-i", run: (view) => wrapSelection(view, "_") },
            {
              key: "Mod-k",
              run: (view) =>
                wrapSelection(view, "[", "](https://example.com)", "link text"),
            },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              change.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [id]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: [
        compartments.current.mode.reconfigure(
          mode === "live" ? liveMarkdown : [],
        ),
        compartments.current.editable.reconfigure([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
      ],
    });
    view.current?.requestMeasure();
  }, [mode, disabled, fullPage]);
  useEffect(() => {
    if (!preview) view.current?.focus();
  }, [preview]);
  useLayoutEffect(() => {
    const element = layout.current;
    if (!element) return;
    const key = preview ? "preview" : "edit";
    element.scrollTop = scrollPositions.current[key];
    const remember = () => {
      scrollPositions.current[key] = element.scrollTop;
    };
    element.addEventListener("scroll", remember);
    return () => element.removeEventListener("scroll", remember);
  }, [preview]);
  const headings = useMemo(() => {
    const result: { title: string; from: number; level: number }[] = [];
    markdownLanguage.parser.parse(value).iterate({
      enter(node) {
        const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
        if (match)
          result.push({
            title: value
              .slice(node.from, node.to)
              .split("\n")[0]
              .replace(/^#+\s*/, "")
              .replace(/\s+#+$/, ""),
            from: node.from,
            level: Number(match[1]),
          });
      },
    });
    return result;
  }, [value]);
  function command(run: (editor: EditorView) => unknown) {
    if (view.current && !disabled) {
      run(view.current);
      view.current.focus();
    }
  }
  return (
    <div
      className={`markdown-editor live-editor${fullPage ? " page-writing" : ""}`}
      data-mode={mode}
    >
      <div className="editor-heading">
        <span id={`${id}-label`}>{preview ? "Reading" : "Your words"}</span>
        {!preview && (
          <SegmentedControl
            label="Editor mode"
            value={writingMode}
            onChange={setWritingMode}
            options={[
              { value: "live", label: "Write" },
              { value: "source", label: "Markdown" },
            ]}
          />
        )}
        <button
          type="button"
          className="app-button secondary mode-toggle"
          data-focus-key="note-mode"
          title="Edit / preview (⌘ / Ctrl E)"
          aria-keyshortcuts="Control+e Meta+e"
          onClick={() => onPreviewChange?.(!preview)}
        >
          {preview ? <Pencil size={15} /> : <Eye size={15} />}
          {preview ? "Edit note" : "Preview"}
        </button>
      </div>
      <div className="editor-surface">
        <div
          hidden={preview}
          className="editor-tools"
          role="group"
          aria-label="Markdown formatting"
        >
          {[
            { name: "Undo", icon: Undo2, run: undo },
            { name: "Redo", icon: Redo2, run: redo },
            {
              name: "Heading",
              icon: Heading2,
              run: (v: EditorView) => prefixLines(v, "## "),
            },
            {
              name: "Bold",
              icon: Bold,
              run: (v: EditorView) => wrapSelection(v, "**"),
            },
            {
              name: "Italic",
              icon: Italic,
              run: (v: EditorView) => wrapSelection(v, "_"),
            },
            {
              name: "Bullet list",
              icon: List,
              run: (v: EditorView) => prefixLines(v, "- "),
            },
            {
              name: "Checklist",
              icon: ListChecks,
              run: (v: EditorView) => prefixLines(v, "- [ ] "),
            },
            {
              name: "Quote",
              icon: Quote,
              run: (v: EditorView) => prefixLines(v, "> "),
            },
            {
              name: "Code",
              icon: Code,
              run: (v: EditorView) => wrapSelection(v, "`"),
            },
            {
              name: "Link",
              icon: LinkIcon,
              run: (v: EditorView) =>
                wrapSelection(v, "[", "](https://example.com)", "link text"),
            },
          ].map(({ name, icon: Icon, run }) => (
            <IconButton
              key={name}
              label={name}
              disabled={disabled || mode === "preview"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(run)}
            >
              <Icon size={16} />
            </IconButton>
          ))}
          <button
            type="button"
            className="app-icon editor-outline-toggle"
            aria-label="Note outline"
            title="Note outline"
            aria-expanded={outline}
            onClick={() => setOutline(!outline)}
          >
            <ListTree size={16} />
          </button>
        </div>
        <div
          ref={layout}
          className={`writing-layout${outline ? " with-outline" : ""}`}
        >
          <div className="writing-paper">
            <div
              ref={host}
              hidden={mode === "preview"}
              className="codemirror-host"
            />
            {mode === "preview" && (
              <div
                className="editor-preview reader-copy"
                aria-label="Markdown preview"
              >
                {value ? (
                  <Markdown>{value}</Markdown>
                ) : (
                  <p className="text-muted">
                    Your formatted note will appear here.
                  </p>
                )}
              </div>
            )}
            {children}
          </div>
          {outline && (
            <aside className="writing-outline" aria-label="Note outline">
              <h2>On this page</h2>
              {headings.length ? (
                <ul>
                  {headings.map((heading) => (
                    <li key={heading.from}>
                      <button
                        type="button"
                        disabled={disabled}
                        style={{
                          paddingLeft: Math.min(heading.level - 1, 3) * 12,
                        }}
                        onClick={() => {
                          setWritingMode("live");
                          onPreviewChange?.(false);
                          requestAnimationFrame(() =>
                            command((editor) =>
                              editor.dispatch({
                                selection: { anchor: heading.from },
                                effects: EditorView.scrollIntoView(
                                  heading.from,
                                  { y: "center" },
                                ),
                              }),
                            ),
                          );
                        }}
                      >
                        {heading.title || "Untitled heading"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Add a heading to find your way around.</p>
              )}
            </aside>
          )}
        </div>
        <div className="editor-footer" id={`${id}-help`}>
          <span>
            {mode === "live"
              ? "Live Markdown · select text to format"
              : mode === "source"
                ? "Markdown source"
                : "Reading preview"}
          </span>
          <span>
            {value.trim()
              ? value.trim().split(/\s+/).length.toLocaleString()
              : 0}{" "}
            words · {value.length.toLocaleString()} / 6,000
          </span>
        </div>
      </div>
      {limit && (
        <p role="alert" className="app-error">
          This draft exceeds the 6,000-character save limit. Shorten it to save,
          or use Export to keep a copy of all your writing.
        </p>
      )}
    </div>
  );
}
