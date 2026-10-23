"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react";
import { type EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import {
  undo,
  redo,
  undoDepth,
  redoDepth,
  isolateHistory,
  selectAll,
} from "@codemirror/commands";
import {
  Bold,
  Italic,
  Code,
  Copy,
  Scissors,
  ClipboardPaste,
  Undo2,
  Redo2,
  ImagePlus,
  ExternalLink,
  Download,
  Trash2,
  TextCursorInput,
  Play,
  Volume2,
  FileText,
  MousePointer2,
} from "lucide-react";
import { mediaReferenceId } from "@lib/shared/media";
import { mediaSource } from "@/lib/media-path";
import { isActiveSurface } from "@/lib/workspace-keyboard";
import { wrapSelection } from "./markdown-surface";
import { ContextMenu, type ContextAction } from "./ui/context-menu";
import { WorkspaceNotice } from "./toasts";

type Target = {
  from: number;
  to: number;
  kind: "image" | "recording" | "link";
  url: string;
  element?: HTMLElement;
};
type Context = {
  surface: HTMLElement;
  actions?: ContextAction[];
  key: number;
  value: string;
  preview: boolean;
  disabled: boolean;
  noteId?: string;
  version?: number;
  x: number;
  y: number;
  state: EditorState;
  target?: Target;
  selected: string;
  opener: HTMLElement | null;
};

function safeLink(value: string) {
  try {
    const url = new URL(value, location.href);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Source targeting uses the Markdown tree, never matching a repeated string. */
function sourceTarget(
  editor: EditorView,
  position: number,
): Target | undefined {
  const tree = ensureSyntaxTree(editor.state, editor.state.doc.length, 30);
  // At the end of a selected reference, the forward-biased node is the next
  // paragraph. Resolve back into the selected syntax instead.
  const selection = editor.state.selection.main;
  const bias = !selection.empty && position === selection.to ? -1 : 1;
  let node = tree?.resolveInner(position, bias);
  while (node) {
    if (node.name === "Image" || node.name === "Link") {
      const urlNode = node.getChild("URL");
      if (!urlNode) return;
      const raw = editor.state
        .sliceDoc(urlNode.from, urlNode.to)
        .replace(/^<|>$/g, "");
      const id = mediaReferenceId(raw);
      const url = id ? raw : safeLink(raw);
      if (!url) return;
      return {
        from: node.from,
        to: node.to,
        kind: node.name === "Image" ? "image" : id ? "recording" : "link",
        url,
      };
    }
    node = node.parent ?? undefined;
  }
}

export function NoteContextMenu({
  editor,
  surface,
  value,
  preview,
  disabled,
  media,
  edit,
  addImage,
}: {
  editor: RefObject<EditorView | null>;
  surface: RefObject<HTMLDivElement | null>;
  value: string;
  preview: boolean;
  disabled: boolean;
  media?: { noteId: string; version?: number; live?: boolean };
  edit: () => void;
  addImage?: () => void;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [message, setMessage] = useState("");
  const menuKey = useRef(0);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const token = lifetime.current;
    token.active = true;
    return () => {
      token.active = false;
    };
  }, []);
  // Build actions at the opening gesture, capturing one document and selection.
  // Ref reads belong to events, never to the React render path.
  function buildActions(context: Context) {
    const current = () => {
      const view = editor.current;
      return lifetime.current.active &&
        menuKey.current === context.key &&
        view &&
        view.state.doc === context.state.doc &&
        !disabled &&
        !view.state.readOnly
        ? view
        : null;
    };
    const mutate = (run: (view: EditorView) => unknown) => {
      const view = current();
      if (view) run(view);
      else setMessage("The note changed. Open the menu again to edit it.");
    };
    const replace = (from: number, to: number, insert: string) =>
      mutate((view) => {
        if (view.state.doc.length - (to - from) + insert.length > 6000) {
          setMessage("Shorten the note before inserting more text.");
          return;
        }
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          annotations: isolateHistory.of("full"),
          userEvent: "input.context",
        });
      });
    const copy = async (text: string, cut = false) => {
      try {
        await navigator.clipboard.writeText(text);
        if (!lifetime.current.active) return;
        if (
          cut &&
          !editor.current?.state.selection.eq(context.state.selection)
        ) {
          setMessage("The selection changed. Open the menu again to cut.");
          return;
        }
        if (cut)
          replace(
            context.state.selection.main.from,
            context.state.selection.main.to,
            "",
          );
        else setMessage("Copied.");
      } catch {
        setMessage(
          "Clipboard access is unavailable. Select the text and use your browser’s Copy command (Shift + right-click). ",
        );
      }
    };
    const actions: ContextAction[] = [];
    const target = context.target;
    const writable = !disabled && !context.state.readOnly;
    if (target) {
      const id = mediaReferenceId(target.url);
      const url =
        id && media
          ? mediaSource(
              media.noteId,
              id,
              media.live ? undefined : media.version,
            )
          : safeLink(target.url);
      const recording =
        target.element?.querySelector<HTMLElement>(".recording-player");
      if (target.kind === "recording") {
        if (recording) {
          actions.push({
            label: "Play / pause recording",
            run: () =>
              recording
                .querySelector<HTMLButtonElement>(".audio-player-play")
                ?.click(),
            icon: <Play size={16} />,
          });
          actions.push({
            label: "Mute / unmute recording",
            run: () =>
              recording
                .querySelector<HTMLButtonElement>(".audio-player-mute")
                ?.click(),
            icon: <Volume2 size={16} />,
          });
          actions.push({
            label: "Show / hide transcript",
            run: () =>
              recording
                .querySelector<HTMLButtonElement>("[data-transcript-toggle]")
                ?.click(),
            icon: <FileText size={16} />,
          });
        }
      }
      if (url) {
        actions.push({
          label: target.kind === "link" ? "Open link" : "Open original",
          run: () => {
            window.open(url, "_blank", "noopener,noreferrer");
          },
          icon: <ExternalLink size={16} />,
        });
        if (id)
          actions.push({
            label: "Download original",
            run: () => {
              const link = document.createElement("a");
              link.href = url;
              link.download = "";
              link.click();
            },
            icon: <Download size={16} />,
          });
        actions.push({
          label:
            target.kind === "link" ? "Copy link address" : "Copy media address",
          run: () => {
            void copy(new URL(url, location.href).href);
          },
          icon: <Copy size={16} />,
        });
      }
      if (target.to > target.from) {
        actions.push({
          label: "Copy Markdown",
          run: () => {
            void copy(context.state.sliceDoc(target.from, target.to));
          },
          icon: <Copy size={16} />,
        });
        actions.push({
          label: "Edit in Markdown",
          run: () => {
            mutate((view) => {
              edit();
              view.dispatch({
                selection: { anchor: target.from, head: target.to },
                effects: EditorView.scrollIntoView(target.from),
              });
            });
          },
          icon: <TextCursorInput size={16} />,
          disabled: !writable,
        });
        actions.push({
          label: "Remove from note",
          run: () => replace(target.from, target.to, ""),
          icon: <Trash2 size={16} />,
          danger: true,
          disabled: !writable,
        });
      }
    }
    actions.push({
      label: "Undo",
      run: () => mutate(undo),
      icon: <Undo2 size={16} />,
      separator: !!target,
      disabled: !writable || !undoDepth(context.state),
    });
    actions.push({
      label: "Redo",
      run: () => mutate(redo),
      icon: <Redo2 size={16} />,
      disabled: !writable || !redoDepth(context.state),
    });
    actions.push({
      label: "Copy selection",
      run: () => {
        void copy(context.selected);
      },
      icon: <Copy size={16} />,
      separator: true,
      disabled: !context.selected,
    });
    if (!preview) {
      actions.push({
        label: "Cut",
        run: () => {
          void copy(context.selected, true);
        },
        icon: <Scissors size={16} />,
        disabled: !writable || !context.selected,
      });
      actions.push({
        label: "Paste text",
        run: () => {
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (!lifetime.current.active) return;
              if (!text) {
                setMessage("The clipboard has no text to paste.");
                return;
              }
              if (editor.current?.state.selection.eq(context.state.selection))
                replace(
                  context.state.selection.main.from,
                  context.state.selection.main.to,
                  text,
                );
              else
                setMessage(
                  "The selection changed. Open the menu again to paste.",
                );
            })
            .catch(() =>
              setMessage(
                "Clipboard access is unavailable. Use Ctrl/Cmd + V to paste at the cursor.",
              ),
            );
        },
        icon: <ClipboardPaste size={16} />,
        disabled: !writable || !navigator.clipboard?.readText,
      });
      actions.push({
        label: "Select all",
        run: () => {
          if (editor.current) selectAll(editor.current);
        },
        icon: <MousePointer2 size={16} />,
      });
      for (const [label, marker, Icon] of [
        ["Bold", "**", Bold],
        ["Italic", "_", Italic],
        ["Code", "`", Code],
      ] as const)
        actions.push({
          label,
          run: () => mutate((view) => wrapSelection(view, marker)),
          icon: <Icon size={16} />,
          separator: label === "Bold",
          disabled: !writable,
        });
    } else {
      actions.push({
        label: "Copy note Markdown",
        run: () => {
          void copy(context.state.doc.toString());
        },
        icon: <Copy size={16} />,
      });
      actions.push({
        label: "Edit note",
        run: edit,
        icon: <TextCursorInput size={16} />,
        disabled: !writable,
      });
    }
    if (addImage)
      actions.push({
        label: "Add image…",
        run: addImage,
        icon: <ImagePlus size={16} />,
        separator: true,
        disabled: !writable,
      });
    return actions;
  }
  const open = useEffectEvent((event: MouseEvent | KeyboardEvent) => {
    const view = editor.current;
    const area = surface.current;
    const element =
      event.target instanceof HTMLElement
        ? event.target
        : event.target instanceof Element
          ? event.target.closest<HTMLElement>("button, a, [data-note-media]")
          : null;
    if (!view || !area || !element || !isActiveSurface(area)) return;
    // Transcript drafts and native form controls keep their own editing menu.
    if (
      element.closest("textarea, input, select") ||
      (element.isContentEditable && !view.contentDOM.contains(element))
    )
      return;
    if (event instanceof MouseEvent && event.shiftKey) return;
    const keyboard =
      event instanceof KeyboardEvent ||
      (event.clientX === 0 && event.clientY === 0);
    let target: Target | undefined;
    let x = keyboard
      ? element.getBoundingClientRect().left + 16
      : (event as MouseEvent).clientX;
    let y = keyboard
      ? element.getBoundingClientRect().top + 24
      : (event as MouseEvent).clientY;
    if (!preview) {
      const position = keyboard
        ? view.state.selection.main.head
        : (view.posAtCoords({ x, y }, false) ?? view.state.doc.length);
      if (position !== null) {
        target = sourceTarget(view, position);
        const selection = view.state.selection.main;
        if (!keyboard && (position < selection.from || position > selection.to))
          view.dispatch({ selection: { anchor: position } });
      }
      if (keyboard) {
        const rect = view.coordsAtPos(view.state.selection.main.head);
        if (rect) {
          x = rect.left;
          y = rect.bottom;
        }
      }
    } else {
      const attachment = element.closest<HTMLElement>("[data-note-media]");
      if (attachment) {
        const from = Number(attachment.dataset.noteFrom),
          to = Number(attachment.dataset.noteTo);
        if (
          Number.isInteger(from) &&
          Number.isInteger(to) &&
          from >= 0 &&
          to <= value.length
        )
          target = {
            from: value.slice(0, from).replace(/\r\n?/g, "\n").length,
            to: value.slice(0, to).replace(/\r\n?/g, "\n").length,
            kind: attachment.dataset.noteMedia as Target["kind"],
            url: attachment.dataset.noteUrl ?? "",
            element: attachment,
          };
      } else {
        const link = element.closest<HTMLAnchorElement>("a[href]");
        if (link && safeLink(link.href))
          target = {
            from: 0,
            to: 0,
            kind: "link",
            url: link.href,
            element: link,
          };
      }
    }
    event.preventDefault();
    event.stopPropagation();
    const selection = window.getSelection();
    const selected = preview
      ? selection &&
        area.contains(selection.anchorNode) &&
        area.contains(selection.focusNode)
        ? selection.toString()
        : ""
      : view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        );
    setMessage("");
    menuKey.current++;
    const context: Context = {
      surface: area,
      key: menuKey.current,
      value,
      preview,
      disabled,
      noteId: media?.noteId,
      version: media?.live ? undefined : media?.version,
      x,
      y,
      state: view.state,
      target,
      selected,
      opener:
        element.closest<HTMLElement>("button, a[href], [tabindex]") ??
        (document.activeElement as HTMLElement | null),
    };
    setContext({ ...context, actions: buildActions(context) });
  });
  useEffect(() => {
    const area = surface.current;
    if (!area) return;
    const pointer = (event: MouseEvent) => open(event);
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      )
        open(event);
    };
    area.addEventListener("contextmenu", pointer, true);
    area.addEventListener("keydown", keyboard, true);
    return () => {
      area.removeEventListener("contextmenu", pointer, true);
      area.removeEventListener("keydown", keyboard, true);
    };
  }, [surface]);
  // Invalidate the captured context during render, without an extra effect/render.
  if (
    !context ||
    context.value !== value ||
    context.preview !== preview ||
    context.disabled !== disabled ||
    context.noteId !== media?.noteId ||
    context.version !== (media?.live ? undefined : media?.version)
  )
    return message ? (
      <WorkspaceNotice>
        {message}
        <button
          type="button"
          className="text-button"
          onClick={() => setMessage("")}
        >
          Dismiss
        </button>
      </WorkspaceNotice>
    ) : null;
  const target = context.target;
  return (
    <ContextMenu
      key={context.key}
      x={context.x}
      surface={context.surface}
      y={context.y}
      label={
        target
          ? `${target.kind === "recording" ? "Recording" : target.kind === "image" ? "Image" : "Link"} actions`
          : "Note actions"
      }
      actions={context.actions ?? []}
      close={() =>
        setContext((current) => (current?.key === context.key ? null : current))
      }
      restoreFocus={() => {
        if (!preview) editor.current?.focus();
        else if (
          context.opener?.isConnected &&
          surface.current?.contains(context.opener)
        )
          context.opener.focus({ preventScroll: true });
        else surface.current?.focus({ preventScroll: true });
      }}
    />
  );
}
