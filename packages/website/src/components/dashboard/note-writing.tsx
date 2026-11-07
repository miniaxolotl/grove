"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  englishMessages,
  mapIgnoredIssues,
  type WritingIssue,
  type WritingPatch,
  type WritingResult,
  type WritingSettings,
} from "@lib/shared/writing-settings";
import { loadEnglishDictionary } from "@/lib/writing/dictionary";
import {
  loadWritingSettings,
  NATIVE_WRITING_ATTRIBUTE,
  saveWritingSettings,
  subscribeWritingSettings,
} from "@/lib/writing/settings";
import { setWritingIssues } from "@/lib/writing/proofing";

type Checker = {
  check: (source: string, settings: WritingSettings) => WritingResult;
  suggest: (word: string) => string[];
};

async function loadChecker(signal: AbortSignal): Promise<Checker> {
  const [{ createEnglishChecker }, dictionary] = await Promise.all([
    import("@lib/shared/writing-core"),
    loadEnglishDictionary(signal),
  ]);
  signal.throwIfAborted();
  return createEnglishChecker(dictionary);
}

export type WritingStatus =
  | "idle"
  | "checking"
  | "ready"
  | "unavailable"
  | "off";

export function useWritingProofing(
  view: EditorView | null,
  doc: string,
  options: { disabled?: boolean; preview?: boolean } = {},
) {
  const { disabled = false, preview = false } = options;
  const [settings, setSettings] = useState<WritingSettings>(() =>
    loadWritingSettings(),
  );
  const [issues, setIssues] = useState<WritingIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [status, setStatus] = useState<WritingStatus>("idle");
  const [notice, setNotice] = useState("");
  const [lookup, setLookup] = useState<{ id: string; words: string[] } | null>(
    null,
  );
  const checker = useRef<Promise<Checker> | null>(null);
  const snapshot = useRef("");
  const ignored = useRef<WritingIssue[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const state = useRef({ settings, disabled, preview, doc });
  useEffect(() => {
    state.current = { settings, disabled, preview, doc };
  });

  useEffect(() => subscribeWritingSettings(() => setSettings(loadWritingSettings())), []);

  const active =
    !disabled && !preview && settings.enabled && (settings.spelling || settings.grammar);

  // First-party ownership marker: the browser extension stands down on pages
  // that advertise native proofing, so two writers never share one editor.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!view || !active) {
      if (!document.querySelector("[data-grove-native-writing]")) return;
      document.documentElement.removeAttribute(NATIVE_WRITING_ATTRIBUTE);
      return;
    }
    document.documentElement.setAttribute(NATIVE_WRITING_ATTRIBUTE, "true");
    return () => {
      document.documentElement.removeAttribute(NATIVE_WRITING_ATTRIBUTE);
    };
  }, [view, active]);

  // Native browser spellcheck draws a second set of underlines; the qualified
  // Grove adapter replaces its visual function while active and restores it.
  useEffect(() => {
    const element = view?.contentDOM;
    if (!element) return;
    const previous = element.getAttribute("spellcheck");
    element.setAttribute("spellcheck", active ? "false" : "true");
    return () => {
      if (previous === null) element.removeAttribute("spellcheck");
      else element.setAttribute("spellcheck", previous);
    };
  }, [view, active]);

  const runCheck = useCallback(
    async (text: string, manual: boolean) => {
      const current = state.current;
      if (
        current.disabled ||
        current.preview ||
        !current.settings.enabled ||
        (!current.settings.spelling && !current.settings.grammar)
      ) {
        setIssues([]);
        setStatus("off");
        return;
      }
      if (!manual && !current.settings.automatic) return;
      if (!text.trim()) {
        snapshot.current = text;
        ignored.current = [];
        setIssues([]);
        setStatus("ready");
        return;
      }
      setStatus("checking");
      setNotice("");
      try {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        checker.current ??= loadChecker(controller.signal);
        const engine = await checker.current;
        controller.signal.throwIfAborted();
        if (state.current.doc !== text) return;
        const fresh = engine.check(text, state.current.settings);
        const kept = mapIgnoredIssues(snapshot.current, text, ignored.current);
        ignored.current = kept;
        const hidden = new Set(kept.map((issue) => issue.id));
        snapshot.current = text;
        setIssues(fresh.issues.filter((issue) => !hidden.has(issue.id)));
        setStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        checker.current = null;
        setStatus("unavailable");
        setNotice(
          error instanceof Error
            ? error.message
            : "Writing checks aren’t available. Try again.",
        );
      }
    },
    [],
  );

  const checkNow = useCallback(
    (manual = true) => runCheck(state.current.doc, manual),
    [runCheck],
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // Scheduling only: all state updates happen in the async check, never
    // synchronously in this effect. Empty and inactive states resolve there.
    timer.current = setTimeout(
      () => {
        if (!composing.current) void runCheck(state.current.doc, false);
      },
      composing.current ? 800 : 350,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc, active, runCheck]);

  // Keep decorations in sync with the visible issue set.
  const visible = useMemo(
    () => (settings.highlights ? issues : []),
    [settings.highlights, issues],
  );
  useEffect(() => {
    if (view) view.dispatch({ effects: setWritingIssues.of(visible) });
  }, [view, visible]);

  // Click an underline to review it; Alt+Enter opens the issue list.
  useEffect(() => {
    if (!view) return;
    const element = view.dom;
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null || view.state.selection.main.from !== view.state.selection.main.to)
        return;
      const hit = issues.find((issue) => issue.from <= pos && pos <= issue.to);
      if (hit) {
        setSelectedId(hit.id);
        setListOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.isTrusted && event.altKey && event.key === "Enter") {
        event.preventDefault();
        setListOpen(true);
      }
    };
    const onComposition = (event: Event) => {
      composing.current = event.type === "compositionstart";
      if (composing.current && timer.current) clearTimeout(timer.current);
    };
    element.addEventListener("click", onClick);
    element.addEventListener("keydown", onKey);
    element.addEventListener("compositionstart", onComposition);
    element.addEventListener("compositionend", onComposition);
    return () => {
      element.removeEventListener("click", onClick);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("compositionstart", onComposition);
      element.removeEventListener("compositionend", onComposition);
    };
  }, [view, issues]);

  const selected = issues.find((issue) => issue.id === selectedId) ?? null;
  const alternatives =
    selected && lookup?.id === selected.id
      ? lookup.words
      : (selected?.replacements ?? []);

  // Lookup-only suggestions when a spelling card opens: typing never suggests.
  // The derived fallback above covers the synchronous render; this effect only
  // fills in the async lookup result.
  useEffect(() => {
    if (!selected || selected.rule !== "spelling" || !checker.current) return;
    let cancelled = false;
    checker.current
      .then((engine) => {
        if (!cancelled)
          setLookup({ id: selected.id, words: engine.suggest(selected.original) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const applyReplacement = useCallback(
    (issue: WritingIssue, replacement: string) => {
      const editor = view;
      if (!editor) return false;
      const doc = editor.state.doc.toString();
      // Conservative apply: the live range must still hold the exact source
      // text, and spelling suggestions come from the on-open lookup, not the
      // issue payload — so validate the range, not issue membership.
      if (
        issue.from < 0 ||
        issue.to > doc.length ||
        issue.to <= issue.from ||
        doc.slice(issue.from, issue.to) !== issue.original ||
        replacement === issue.original
      ) {
        setNotice("Writing changed. Check it again before applying this suggestion.");
        checkNow(true);
        return false;
      }
      editor.dispatch({
        changes: { from: issue.from, to: issue.to, insert: replacement },
        selection: { anchor: issue.from + replacement.length },
      });
      editor.focus();
      ignored.current = mapIgnoredIssues(
        snapshot.current,
        editor.state.doc.toString(),
        ignored.current.filter((kept) => kept.id !== issue.id),
      );
      snapshot.current = editor.state.doc.toString();
      setIssues((current) => current.filter((kept) => kept.id !== issue.id));
      setSelectedId(null);
      return true;
    },
    [view, checkNow],
  );

  const ignoreIssue = useCallback((issue: WritingIssue) => {
    ignored.current = [...ignored.current, issue];
    setIssues((current) => current.filter((kept) => kept.id !== issue.id));
    setSelectedId(null);
  }, []);

  const addWord = useCallback(
    (word: string) => {
      const clean = word.trim();
      if (!clean) return;
      const { words } = loadWritingSettings();
      if (
        !words.some(
          (entry) => entry.toLocaleLowerCase("en") === clean.toLocaleLowerCase("en"),
        )
      )
        setSettings(saveWritingSettings({ words: [...words, clean] }));
      setIssues((current) =>
        current.filter(
          (issue) =>
            !(
              issue.rule === "spelling" &&
              issue.original.toLocaleLowerCase("en") === clean.toLocaleLowerCase("en")
            ),
        ),
      );
      setSelectedId(null);
      checkNow(true);
    },
    [checkNow],
  );

  const updateSettings = useCallback(
    (patch: WritingPatch) => setSettings(saveWritingSettings(patch)),
    [],
  );

  return {
    settings,
    updateSettings,
    issues,
    visible,
    selected,
    selectIssue: (id: string | null) => {
      setSelectedId(id);
      if (id) setListOpen(false);
    },
    listOpen,
    setListOpen,
    alternatives,
    applyReplacement,
    ignoreIssue,
    addWord,
    checkNow,
    status: active ? status : "off",
    notice,
  };
}

export function writingCategoryLabel(rule: WritingIssue["rule"]): string {
  return rule === "spelling" ? "Spelling" : "Grammar";
}

/** Compact anchored card: one issue, short explanation, replacements, actions. */
export function WritingIssueCard({
  view,
  issue,
  alternatives,
  notice,
  onApply,
  onIgnore,
  onAddWord,
  onClose,
  onAllIssues,
}: {
  view: EditorView | null;
  issue: WritingIssue;
  alternatives: string[];
  notice: string;
  onApply: (replacement: string) => void;
  onIgnore: () => void;
  onAddWord: () => void;
  onClose: () => void;
  onAllIssues: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const card = ref.current;
    if (!card || !view) return;
    const coords = view.coordsAtPos(Math.max(0, issue.from));
    const rect = card.getBoundingClientRect();
    const top = Math.min(
      Math.max(8, (coords?.bottom ?? 120) + 8),
      Math.max(8, window.innerHeight - rect.height - 8),
    );
    const left = Math.min(
      Math.max(8, (coords?.left ?? 16) - 16),
      Math.max(8, window.innerWidth - rect.width - 8),
    );
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    const closeOnScroll = () => onClose();
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [view, issue, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <section
      ref={ref}
      role="dialog"
      aria-label={`Writing suggestion: ${issue.message}`}
      className="grove-writing-card"
    >
      <header>
        <strong>{writingCategoryLabel(issue.rule)}</strong>
        <button type="button" className="grove-writing-close" onClick={onClose} aria-label="Close suggestion">
          ×
        </button>
      </header>
      <p>{englishMessages[issue.message] ?? issue.message}</p>
      {alternatives.length > 0 ? (
        <div className="grove-writing-replacements">
          {alternatives.map((replacement) => (
            <button
              key={replacement}
              type="button"
              className="grove-writing-replacement"
              onClick={() => onApply(replacement)}
            >
              {replacement === "" ? "Delete extra word" : replacement}
            </button>
          ))}
        </div>
      ) : (
        <p className="grove-writing-original">“{issue.original}”</p>
      )}
      {notice ? (
        <p className="grove-writing-notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="grove-writing-actions">
        <button type="button" onClick={onIgnore}>
          Ignore
        </button>
        {issue.rule === "spelling" ? (
          <button type="button" onClick={onAddWord}>
            Add word
          </button>
        ) : null}
        <button type="button" onClick={onAllIssues}>
          All issues
        </button>
      </div>
    </section>
  );
}

/** Quiet status affordance: at most one restrained button near the editor. */
export function WritingStatusButton({
  status,
  count,
  onOpen,
  onRetry,
}: {
  status: WritingStatus;
  count: number;
  onOpen: () => void;
  onRetry: () => void;
}) {
  if (status === "off" || status === "idle") return null;
  if (status === "checking")
    return (
      <span className="grove-writing-status" role="status">
        Checking…
      </span>
    );
  if (status === "unavailable")
    return (
      <button type="button" className="grove-writing-status" onClick={onRetry}>
        Retry writing checks
      </button>
    );
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="grove-writing-status"
      onClick={onOpen}
      title="Spelling and basic grammar · Alt+Enter"
    >
      {count} suggestion{count === 1 ? "" : "s"}
    </button>
  );
}
