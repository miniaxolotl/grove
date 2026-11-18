"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  dictionaryWordKey,
  englishMessages,
  personalWordLimit,
  type WritingIssue,
  type WritingPatch,
  type WritingSettings,
} from "@lib/shared/writing-settings";
import { isolateHistory } from '@codemirror/commands';
import { openWritingChecker } from '@/lib/writing/harper';
import { useEnhancedConsent } from '@/lib/writing/enhanced';
import { EditorChecks, type CheckState, type WritingStatus } from '@/lib/writing/editor-checks';
import {
  loadWritingSettings,
  NATIVE_WRITING_ATTRIBUTE,
  saveWritingSettings,
  subscribeWritingSettings,
} from "@/lib/writing/settings";
import { setWritingIssues } from "@/lib/writing/proofing";

const blank: CheckState = { issues: [], status: 'idle', notice: '', enhancedStatus: '' };
export function useWritingProofing(view: EditorView | null, { disabled, preview, noteId }: {disabled?:boolean; preview?:boolean; noteId?:string}) {
  const [settings, setSettings] = useState<WritingSettings>(loadWritingSettings);
  const [result, setResult] = useState<CheckState>(blank);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const active = !preview && !disabled && settings.enabled && (settings.grammar || settings.spelling);
  const { grant, request, current } = useEnhancedConsent(!!view && active);
  const worker = useRef<ReturnType<typeof openWritingChecker> | null>(null);
  const controller = useRef<EditorChecks | null>(null);
  const ignored = useRef<WritingIssue[]>([]);
  useLayoutEffect(() => { ignored.current = []; return () => { worker.current?.dispose(); worker.current = null; }; }, [view, noteId]);
  useLayoutEffect(() => {
    if (!active || !view) return;
    const checks = new EditorChecks(view, settings, {grant, request, current}, worker, ignored, setResult);
    controller.current = checks;
    return () => { checks.stop(); controller.current = null; };
  }, [active, view, settings, grant, request, current, noteId]);
  useEffect(() => subscribeWritingSettings(() => setSettings(loadWritingSettings())), []);
  useEffect(() => {
    if (!view) return;
    // Preserve first-party ownership even when the writer opts out.
    document.documentElement.setAttribute(NATIVE_WRITING_ATTRIBUTE, 'true');
    const previous = view.contentDOM.getAttribute('spellcheck');
    view.contentDOM.setAttribute('spellcheck', active ? 'false' : 'true');
    return () => {
      document.documentElement.removeAttribute(NATIVE_WRITING_ATTRIBUTE);
      if (previous === null) view.contentDOM.removeAttribute('spellcheck');
      else view.contentDOM.setAttribute('spellcheck', previous);
    };
  }, [view, active]);
  const issues = active ? result.issues : blank.issues;
  const visible = useMemo(() => settings.highlights ? issues : [], [issues, settings.highlights]);
  useEffect(() => { if (view) view.dispatch({ effects: setWritingIssues.of(visible) }); }, [view, visible]);
  useEffect(() => {
    if (!view || !active) return;
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || !view.state.selection.main.empty) return;
      const pos = view.posAtCoords({x: event.clientX, y: event.clientY});
      const hit = issues.find(i => pos !== null && i.from <= pos && pos <= i.to);
      if (hit) { setSelectedId(hit.id); setListOpen(false); setNotice(''); }
    };
    const key = (event: KeyboardEvent) => { if (event.isTrusted && event.altKey && event.key === 'Enter') { event.preventDefault(); setListOpen(true); } };
    view.dom.addEventListener('click',click); view.dom.addEventListener('keydown',key);
    return () => { view.dom.removeEventListener('click',click); view.dom.removeEventListener('keydown',key); };
  }, [view, issues, active]);
  const selected = issues.find(i => i.id === selectedId) ?? null;
  const applyReplacement = (issue: WritingIssue, replacement: string) => {
    if (!view || !controller.current?.canApply(issue,replacement)) { setNotice('Writing changed. Check again before applying.'); return false; }
    view.dispatch({ changes:{ from:issue.from, to:issue.to, insert:replacement }, selection:{ anchor:issue.from+replacement.length }, annotations:isolateHistory.of('full'), userEvent:'input.proofing' });
    view.focus(); setSelectedId(null); return true;
  };
  const updateSettings = (patch: WritingPatch) => setSettings(saveWritingSettings(patch));
  const addWord = (word: string) => {
    const {words} = loadWritingSettings();
    if (words.some(w => dictionaryWordKey(w) === dictionaryWordKey(word))) return;
    if (words.length >= personalWordLimit) { setNotice('Dictionary full. Remove a word in Writing settings first.'); return; }
    updateSettings({words:[...words,word]}); setSelectedId(null);
  };
  const onUpdate = useCallback((update:ViewUpdate) => { controller.current?.change(update); if(update.docChanged) setSelectedId(null); }, []);
  return { settings, updateSettings, selected, selectIssue:setSelectedId, issues, visible, alternatives:selected?.replacements ?? [], applyReplacement,
    ignoreIssue:(issue:WritingIssue) => { controller.current?.ignore(issue); setSelectedId(null); }, addWord,
    checkNow:() => controller.current?.checkLocal(), checkEnhanced:() => controller.current?.manual(), enhanced:grant?.enabled, enhancedStatus:result.enhancedStatus,
    listOpen, setListOpen, status:active ? result.status : 'off' as const, notice:notice || result.notice, onUpdate };
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
  onClose: (restoreFocus: boolean) => void;
  onAllIssues: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const card = ref.current;
    if (!card || !view) return;
    const coords = view.coordsAtPos(Math.max(0, issue.from));
    const rect = card.getBoundingClientRect();
    // Prefer below the issue; flip above when the viewport bottom is near.
    const below = (coords?.bottom ?? 120) + 8;
    const above = (coords?.top ?? 120) - rect.height - 8;
    const top =
      below + rect.height <= window.innerHeight - 8
        ? Math.max(8, below)
        : Math.max(8, above);
    const left = Math.min(
      Math.max(8, (coords?.left ?? 16) - 16),
      Math.max(8, window.innerWidth - rect.width - 8),
    );
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    const autoDismiss = () => closeRef.current(false);
    window.addEventListener("scroll", autoDismiss, true);
    window.addEventListener("resize", autoDismiss);
    return () => {
      window.removeEventListener("scroll", autoDismiss, true);
      window.removeEventListener("resize", autoDismiss);
    };
  }, [view, issue]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current(true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <section
      ref={ref}
      role="dialog"
      aria-label={`Writing suggestion: ${issue.message}`}
      className="grove-writing-card"
    >
      <header>
        <strong>{writingCategoryLabel(issue.rule)}</strong>
        <button type="button" className="grove-writing-close" onClick={() => onClose(true)} aria-label="Close suggestion">
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
        <p className="grove-writing-original">“{issue.rule === "repetition" ? issue.original.trimStart() : issue.original}”</p>
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
