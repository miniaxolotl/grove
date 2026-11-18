import type { EditorView, ViewUpdate } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { dictionaryWordKey, writingRules, type WritingIssue, type WritingSettings } from '@lib/shared/writing-settings';
import { proofingResultSchema } from '@lib/shared/proofing-contract';
import { openWritingChecker } from './harper';
import { projectMarkdownParagraph, protectMarkdownIssues } from './markdown-proofing';
import type { useEnhancedConsent } from './enhanced';

type Enhanced = Pick<ReturnType<typeof useEnhancedConsent>, 'grant' | 'current' | 'request'>;
export type WritingStatus = 'idle' | 'checking' | 'ready' | 'unavailable' | 'off';
export type CheckState = { issues: WritingIssue[]; status: WritingStatus; notice: string; enhancedStatus: string };
const empty = (): CheckState => ({ issues: [], status: 'idle', notice: '', enhancedStatus: '' });

/** Prefer local edits; alternatives are interchangeable only for identical source spans. */
export function mergeWritingIssues(local: WritingIssue[], hosted: WritingIssue[]) {
  const kept: WritingIssue[] = [];
  for (const issue of [...local, ...hosted]) {
    const hit = kept.find(i => i.from < issue.to && issue.from < i.to);
    if (!hit) kept.push({ ...issue, replacements: [...issue.replacements] });
    else if (hit.from === issue.from && hit.to === issue.to)
      hit.replacements = [...new Set([...hit.replacements, ...issue.replacements])];
  }
  return kept.sort((a,b) => a.from - b.from);
}

/** Each lifetime owns one editor, note and settings/consent epoch. No prose in shared caches. */
export class EditorChecks {
  private revision = 0;
  private stopped = false;
  private composing = false;
  private changedAt: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private remoteTimer?: ReturnType<typeof setTimeout>;
  private remote?: AbortController;
  private local: WritingIssue[] = [];
  private hosted: WritingIssue[] = [];
  private state = empty();
  private pendingLocal = false;
  private queued = false;
  constructor(private view: EditorView, private settings: WritingSettings, private enhanced: Enhanced,
    private worker: { current: ReturnType<typeof openWritingChecker> | null },
    private ignored: { current: WritingIssue[] }, private publish: (state: CheckState) => void) {
    view.contentDOM.addEventListener('compositionstart', this.composition);
    view.contentDOM.addEventListener('compositionend', this.composition);
    this.timer = setTimeout(() => { this.paint(); if (settings.automatic) void this.checkLocal(); }, 0);
  }
  private paint() {
    if (this.stopped) return;
    const issues = mergeWritingIssues(this.local, this.hosted).filter(i => !this.ignored.current.some(x => x.from === i.from && x.to === i.to && x.original === i.original));
    this.state = { ...this.state, issues };
    this.publish(this.state);
  }
  private cancel() {
    ++this.revision; clearTimeout(this.timer); clearTimeout(this.remoteTimer); this.remote?.abort(); this.queued = false;
    this.local = []; this.hosted = []; this.state = empty();
  }
  private composition = (event: Event) => {
    this.composing = event.type === 'compositionstart';
    this.cancel(); this.paint();
    if (!this.composing) this.schedule();
  };
  change(update: ViewUpdate) {
    if (!update.docChanged) return;
    this.cancel();
    this.ignored.current = this.ignored.current.flatMap(i => {
      if (update.changes.touchesRange(i.from, i.to)) return [];
      return [{ ...i, from: update.changes.mapPos(i.from, 1), to: update.changes.mapPos(i.to, -1) }];
    });
    // Replacing the editor from props is not a writer editing a paragraph.
    this.changedAt = null;
    if (update.transactions.every(t => t.annotation(Transaction.addToHistory) !== false))
      update.changes.iterChangedRanges((_a, _b, from, to) => { this.changedAt = Math.max(from, to - 1); });
    this.paint(); this.schedule();
  }
  private schedule() {
    if (this.composing || !this.settings.automatic) return;
    this.timer = setTimeout(() => void this.checkLocal(), 350);
    const at = this.changedAt;
    if (this.enhanced.grant?.automatic && at !== null)
      this.remoteTimer = setTimeout(() => void this.checkEnhanced(at, false), 650);
  }
  checkLocal = async () => {
    clearTimeout(this.timer);
    if (this.stopped || this.composing || this.view.state.readOnly) return;
    if (this.pendingLocal) { this.queued = true; return; }
    const rev = this.revision;
    const state = this.view.state;
    const text = state.doc.toString();
    if (!text.trim()) { this.state.status = 'ready'; this.paint(); return; }
    this.pendingLocal = true; this.state.status = 'checking'; this.paint();
    try {
      this.worker.current ??= openWritingChecker();
      const result = await this.worker.current.check(text, this.settings);
      if (rev !== this.revision || this.stopped || state.doc !== this.view.state.doc) return;
      this.local = protectMarkdownIssues(state, result.issues);
      this.state.status = 'ready'; this.state.notice = ''; this.paint();
    } catch {
      if (rev !== this.revision || this.stopped) return;
      this.worker.current?.dispose(); this.worker.current = null;
      this.state.status = 'unavailable'; this.state.notice = 'On-device checks couldn’t load. Try again.'; this.paint();
    } finally {
      this.pendingLocal = false;
      if (this.queued && !this.stopped) { this.queued = false; void this.checkLocal(); }
    }
  };
  manual = () => this.checkEnhanced(this.view.state.selection.main.head, true);
  private async checkEnhanced(at: number, manual: boolean) {
    clearTimeout(this.remoteTimer); this.remote?.abort();
    const grant = this.enhanced.grant;
    if (!grant?.enabled || (!manual && !grant.automatic) || grant.signal.aborted || !this.enhanced.current() || this.stopped || this.composing || this.view.state.readOnly) return;
    const rules = { ...this.settings.rules, spelling: this.settings.spelling };
    for (const family of writingRules) rules[family] &&= this.settings.grammar;
    if (!Object.values(rules).some(Boolean)) return;
    const rev = this.revision, state = this.view.state;
    const block = projectMarkdownParagraph(state, at, 1500);
    this.hosted = [];
    if (!block) {
      if (manual) { this.state.enhancedStatus = 'Choose a prose paragraph of up to 1,500 characters.'; this.paint(); }
      return;
    }
    this.remote = new AbortController();
    const signal = AbortSignal.any([this.remote.signal, grant.signal]);
    const valid = () => !signal.aborted && !this.stopped && rev === this.revision && state.doc === this.view.state.doc && this.enhanced.current();
    this.state.enhancedStatus = manual ? 'Checking paragraph…' : ''; this.paint();
    try {
      const data = proofingResultSchema.parse(await this.enhanced.request('check', 'POST', { text: block.text, revision: rev, rules }, signal, manual ? 'manual' : 'automatic'));
      if (!valid()) return;
      if (data.revision !== rev) throw new Error('Stale check');
      const words = new Set(this.settings.words.map(dictionaryWordKey));
      for (const i of data.issues) {
        if (!rules[i.rule] || !block.allows(i.from,i.to) || block.text.slice(i.from,i.to) !== i.original || (i.rule === 'spelling' && words.has(dictionaryWordKey(i.original)))) continue;
        const from = block.from + i.from, to = block.from + i.to;
        this.hosted.push({ ...i, from, to, id: `enhanced:${i.rule}:${from}:${to}` });
      }
      this.state.enhancedStatus = !data.complete ? 'Paragraph check incomplete.' : manual ? 'Paragraph checked.' : '';
    } catch {
      if (!valid()) return;
      this.state.enhancedStatus = 'Enhanced check unavailable. On-device checks are separate.';
    }
    this.paint();
  }
  canApply(issue: WritingIssue, replacement: string) {
    if (this.stopped || this.composing || this.view.state.readOnly || !this.state.issues.includes(issue) || !issue.replacements.includes(replacement)) return false;
    if (!this.local.some(i => i.from === issue.from && i.to === issue.to && i.replacements.includes(replacement)) && (this.enhanced.grant?.signal.aborted || !this.enhanced.current())) return false;
    return protectMarkdownIssues(this.view.state, [issue]).length === 1;
  }
  ignore(issue: WritingIssue) { this.ignored.current.push(issue); this.paint(); }
  stop() {
    this.stopped = true; this.cancel();
    this.view.contentDOM.removeEventListener('compositionstart', this.composition);
    this.view.contentDOM.removeEventListener('compositionend', this.composition);
  }
}
