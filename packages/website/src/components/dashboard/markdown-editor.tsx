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
  undoDepth,
  redoDepth,
  isolateHistory,
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
  Type,
} from "lucide-react";
import { Markdown } from "./markdown";
import { liveMarkdown, prefixLines, wrapSelection } from "./markdown-surface";
import { SegmentedControl } from "./ui/segmented-control";
import {
  matchesShortcut,
  shortcutHint,
  shortcuts,
} from "@/lib/workspace-shortcuts";
import { isActiveSurface } from "@/lib/workspace-keyboard";
import { IconButton } from "./ui/button";
import { ActionMenu } from "./ui/action-menu";
import { InspectorDialog } from "./ui/inspector-dialog";

const formattingActions = [
  { name: "Undo", icon: Undo2, run: undo, reading: true },
  { name: "Redo", icon: Redo2, run: redo, reading: true },
  {
    name: "Heading",
    icon: Heading2,
    run: (view: EditorView) => prefixLines(view, "## "),
  },
  {
    name: "Bold",
    icon: Bold,
    run: (view: EditorView) => wrapSelection(view, "**"),
  },
  {
    name: "Italic",
    icon: Italic,
    run: (view: EditorView) => wrapSelection(view, "_"),
  },
  {
    name: "Bullet list",
    icon: List,
    run: (view: EditorView) => prefixLines(view, "- "),
  },
  {
    name: "Checklist",
    icon: ListChecks,
    run: (view: EditorView) => prefixLines(view, "- [ ] "),
  },
  {
    name: "Quote",
    icon: Quote,
    run: (view: EditorView) => prefixLines(view, "> "),
  },
  {
    name: "Code",
    icon: Code,
    run: (view: EditorView) => wrapSelection(view, "`"),
  },
  {
    name: "Link",
    icon: LinkIcon,
    run: (view: EditorView) =>
      wrapSelection(view, "[", "](https://example.com)", "link text"),
  },
];

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
  presentation = "page",
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fullPage?: boolean;
  preview?: boolean;
  onPreviewChange?: (preview: boolean) => void;
  presentation?: "page" | "drawer" | "expanded" | "focus";
  children?: ReactNode;
}) {
  const id = useId();
  const documentValue = value.replace(/\r\n?/g, "\n");
  const host = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const previousScroll = useRef(0);
  const view = useRef<EditorView | null>(null);
  const initial = useRef({ value: documentValue, placeholder });
  const change = useRef(onChange);
  const compartments = useRef({
    mode: new Compartment(),
    editable: new Compartment(),
  });
  const [writingMode, setWritingMode] = useState<"live" | "source">("live");
  const mode = preview ? "preview" : writingMode;
  const [outline, setOutline] = useState(false);
  const [historyState, setHistoryState] = useState({
    undo: false,
    redo: false,
  });
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
            const next = {
              undo: undoDepth(update.state) > 0,
              redo: redoDepth(update.state) > 0,
            };
            setHistoryState((current) =>
              current.undo === next.undo && current.redo === next.redo
                ? current
                : next,
            );
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
    if (editor && editor.state.doc.toString() !== documentValue) {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: documentValue,
        },
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }, [documentValue]);
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
    const key = `${presentation}:${preview ? "preview" : "edit"}`;
    element.scrollTop =
      scrollPositions.current.get(key) ?? previousScroll.current;
    const remember = () => {
      scrollPositions.current.set(key, element.scrollTop);
      previousScroll.current = element.scrollTop;
    };
    element.addEventListener("scroll", remember);
    return () => element.removeEventListener("scroll", remember);
  }, [preview, presentation]);
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
      if (!preview) view.current.focus();
    }
  }
  function formatButton(
    { name, icon: Icon, run, reading }: (typeof formattingActions)[number],
    menu = false,
  ) {
    return (
      <button
        key={name}
        type="button"
        className={menu ? undefined : "app-icon"}
        aria-label={name}
        title={name}
        disabled={
          disabled ||
          (preview && !reading) ||
          (name === "Undo" && !historyState.undo) ||
          (name === "Redo" && !historyState.redo)
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => command(run)}
      >
        <Icon size={16} aria-hidden="true" />
        {menu && name}
      </button>
    );
  }
  return (
    <div
      className={`markdown-editor live-editor${fullPage ? " page-writing" : ""}`}
      data-mode={mode}
      onKeyDown={(event) => {
        if (!preview || !isActiveSurface(host.current)) return;
        const run = matchesShortcut(event.nativeEvent, shortcuts.undo)
          ? undo
          : matchesShortcut(event.nativeEvent, shortcuts.redo)
            ? redo
            : undefined;
        if (run) {
          event.preventDefault();
          command(run);
        }
      }}
    >
      <div className="editor-heading">
        <div
          className="editor-modes"
          title={`Edit / preview (${shortcutHint(shortcuts.mode)})`}
        >
          <SegmentedControl
            label="Editor mode"
            value={mode}
            focusKey="note-mode"
            onChange={(next) => {
              if (next !== "preview") setWritingMode(next);
              onPreviewChange?.(next === "preview");
            }}
            options={[
              { value: "live", label: "Write" },
              { value: "source", label: "Markdown" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
        <div
          className="editor-tools"
          role="group"
          aria-label="Markdown formatting"
        >
          {formattingActions.map((action) => formatButton(action))}
        </div>
        <span className="editor-format-menu">
          <ActionMenu label="Formatting" icon={<Type size={18} />}>
            {formattingActions.map((action) => formatButton(action, true))}
          </ActionMenu>
        </span>
        <IconButton
          label="Note outline"
          className="editor-outline-toggle"
          aria-expanded={outline}
          onClick={() => setOutline(true)}
        >
          <ListTree size={17} />
        </IconButton>
      </div>
      <div className="editor-surface">
        <div ref={layout} className="writing-layout">
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
                  <Markdown
                    disabled={disabled}
                    onToggleTask={(offset, checked) => {
                      const editor = view.current;
                      // CodeMirror uses LF positions, including notes imported with CRLF.
                      if (
                        !editor ||
                        disabled ||
                        editor.state.readOnly ||
                        editor.state.doc.toString() !== documentValue
                      )
                        return;
                      const position = value
                        .slice(0, offset)
                        .replace(/\r\n?/g, "\n").length;
                      const marker = editor.state.sliceDoc(
                        position - 1,
                        position + 2,
                      );
                      if (
                        !/^\[[ xX]\]$/.test(marker) ||
                        (marker[1].toLowerCase() === "x") === checked
                      )
                        return;
                      editor.dispatch({
                        changes: {
                          from: position,
                          to: position + 1,
                          insert: checked ? "x" : " ",
                        },
                        annotations: isolateHistory.of("full"),
                        userEvent: "input.task",
                      });
                    }}
                  >
                    {value}
                  </Markdown>
                ) : (
                  <p className="text-muted">
                    Your formatted note will appear here.
                  </p>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
        {outline && (
          <InspectorDialog title="Note outline" close={() => setOutline(false)}>
            <div className="writing-outline">
              {headings.length ? (
                <ul>
                  {headings.map((heading, index) => (
                    <li key={heading.from}>
                      <button
                        type="button"
                        disabled={disabled}
                        style={{
                          paddingLeft: Math.min(heading.level - 1, 3) * 12,
                        }}
                        onClick={() => {
                          setOutline(false);
                          requestAnimationFrame(() => {
                            if (preview) {
                              const target =
                                layout.current?.querySelectorAll<HTMLElement>(
                                  ".editor-preview :is(h1, h2, h3, h4, h5, h6)",
                                )[index];
                              if (target) {
                                target.tabIndex = -1;
                                target.focus({ preventScroll: true });
                                target.scrollIntoView({ block: "start" });
                              }
                            } else
                              command((editor) =>
                                editor.dispatch({
                                  selection: { anchor: heading.from },
                                  effects: EditorView.scrollIntoView(
                                    heading.from,
                                    { y: "center" },
                                  ),
                                }),
                              );
                          });
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
            </div>
          </InspectorDialog>
        )}
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
