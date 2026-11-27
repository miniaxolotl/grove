"use client";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import {
  publicNavigationSchema,
  type PublicNavigation,
} from "@lib/shared/sharing";
import { PaletteDialog } from "../dashboard/ui/palette-dialog";
import { Dialog } from "../dashboard/dialog";
import { Shortcut } from "../dashboard/ui/shortcut";
import { shortcuts } from "@/lib/workspace-shortcuts";

export function ReaderPalette({
  mode,
  root,
  notebook,
  hasOutline,
  unavailable,
  close,
  navigate,
  outline,
}: {
  mode: "search" | "commands" | "help";
  root: string;
  notebook: boolean;
  hasOutline: boolean;
  unavailable: () => void;
  close: () => void;
  navigate: (href: string) => void;
  outline: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicNavigation | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const deny = useEffectEvent(unavailable);
  const selection = useRef<string>(undefined);
  const id = useId();
  useEffect(() => {
    if (mode !== "search" || !query.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError(false);
      try {
        const response = await fetch(`${root}/read`, {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "search", q: query, cursor }),
          signal: controller.signal,
        });
        if (response.status === 404) {
          deny();
          return;
        }
        if (response.status === 400 && cursor) {
          setCursor(undefined);
          setResults(null);
          return;
        }
        if (response.status === 429)
          setRetryAt(
            Date.now() +
              Math.max(1, Number(response.headers.get("retry-after")) || 60) *
                1000,
          );
        if (!response.ok) throw new Error();
        const value = publicNavigationSchema.parse(await response.json());
        if (!controller.signal.aborted)
          setResults((old) =>
            cursor && old
              ? { ...value, results: [...old.results, ...value.results] }
              : value,
          );
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, root, mode, cursor, retry]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(
      () => setRetryAt(0),
      Math.max(0, retryAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [retryAt]);
  const commands = [
    ...(notebook ? [{ label: "Find a note", key: shortcuts.search }] : []),
    ...(hasOutline ? [{ label: "On this page", key: shortcuts.outline }] : []),
    { label: "Keyboard shortcuts", key: shortcuts.help },
  ].filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );
  function open(index: number) {
    if (mode === "search") {
      const note = results?.results[index];
      if (note && !busy && !error) {
        selection.current = `${root}/notes/${note.id}`;
        close();
      }
    } else {
      const command = commands[index];
      if (command) {
        selection.current =
          command.label === "Find a note"
            ? "search"
            : command.label === "Keyboard shortcuts"
              ? "help"
              : "outline";
        close();
      }
    }
  }
  const count =
    mode === "search" ? (results?.results.length ?? 0) : commands.length;
  if (mode === "help")
    return (
      <Dialog title="Keyboard shortcuts" close={close}>
        <dl className="shared-shortcuts">
          {[
            ...commands,
            { label: "Commands", key: shortcuts.commands },
            { label: "Move between rows", key: "↑ ↓" },
            ...(notebook
              ? [{ label: "Previous / next note", key: "← →" }]
              : []),
            { label: "Close dialog", key: "Esc" },
          ].map((command) => (
            <div key={command.label}>
              <dt>{command.label}</dt>
              <dd>
                <Shortcut>{command.key}</Shortcut>
              </dd>
            </div>
          ))}
        </dl>
      </Dialog>
    );
  return (
    <PaletteDialog
      title={mode === "search" ? "Find a note" : "Commands"}
      close={close}
      onDismissed={() => {
        if (selection.current === "outline") outline();
        else if (selection.current) navigate(selection.current);
      }}
      search={{
        label: mode === "search" ? "Find a note" : "Find a command",
        placeholder: mode === "search" ? "Find a note…" : "Find a command…",
        value: query,
        maxLength: 100,
        onChange: (value) => {
          setQuery(value);
          setResults(null);
          setCursor(undefined);
          setActive(0);
          setError(false);
          setBusy(false);
        },
        role: "combobox",
        "aria-controls": id,
        "aria-expanded": true,
        "aria-activedescendant": count ? `${id}-${active}` : undefined,
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((old) =>
              Math.max(
                0,
                Math.min(count - 1, old + (event.key === "ArrowDown" ? 1 : -1)),
              ),
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            open(active);
          }
        },
      }}
      footer={
        <span>
          {mode === "search" ? "Find a note" : "Commands"}{" "}
          <Shortcut>
            {shortcuts[mode === "search" ? "search" : "commands"]}
          </Shortcut>
        </span>
      }
    >
      <div
        className="shared-reader-results"
        role="listbox"
        id={id}
        aria-label={mode === "search" ? "Notes" : "Commands"}
        aria-busy={busy}
      >
        {mode === "search"
          ? results?.results.map((note, index) => (
              <button
                key={note.id}
                id={`${id}-${index}`}
                type="button"
                className="palette-option"
                role="option"
                aria-selected={active === index}
                onClick={() => open(index)}
              >
                <FileText size={17} aria-hidden="true" />
                <span className="palette-option-copy">
                  {note.title || "Untitled note"}
                  <small>{note.notebookName}</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ))
          : commands.map((command, index) => (
              <button
                key={command.label}
                id={`${id}-${index}`}
                type="button"
                className="palette-option"
                role="option"
                aria-selected={active === index}
                onClick={() => open(index)}
              >
                {command.label}
                <Shortcut>{command.key}</Shortcut>
              </button>
            ))}
      </div>
      <div className="shared-search-status" role="status">
        {error ? (
          <>
            Couldn’t search.{" "}
            <button
              disabled={retryAt > 0}
              onClick={() => setRetry((n) => n + 1)}
            >
              Try again
            </button>
          </>
        ) : busy ? (
          "Searching…"
        ) : mode === "search" && results && !results.results.length ? (
          "No matching notes."
        ) : null}
      </div>
      {mode === "search" && results?.nextCursor && (
        <button
          className="shared-next"
          disabled={busy}
          onClick={() => setCursor(results.nextCursor!)}
        >
          More notes
        </button>
      )}
    </PaletteDialog>
  );
}
