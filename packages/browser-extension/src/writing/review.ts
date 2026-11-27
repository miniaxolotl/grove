import { z } from "zod";
import { englishMessages, type WritingIssue } from "./core.ts";

export type ReviewState = {
  editorId: string;
  revision: number;
  phase: "idle" | "checking" | "ready" | "paused" | "disabled" | "failed";
  complete: boolean;
  canApply: boolean;
  spelling: boolean;
  grammar: boolean;
  issues: (WritingIssue & { before?: string; after?: string })[];
  feedback?: string;
  site?: string;
};
export const reviewActionSchema = z
  .object({
    editorId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    action: z.enum(["check", "pause", "resume", "apply", "ignore", "word"]),
    issueId: z.string().max(160).optional(),
    replacement: z.string().max(6000).optional(),
  })
  .strict();
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export const issueCategory = (issue: WritingIssue) =>
  issue.rule === "spelling" ? "spelling" : "grammar";
export function reviewSummary(state: ReviewState) {
  if (state.phase === "paused") return "Off here";
  if (state.phase === "disabled") return "Checks off";
  if (state.phase === "checking") return "Checking…";
  if (state.phase === "failed") return "Check failed";
  if (state.phase !== "ready") return "Check writing";
  if (!state.complete && !state.issues.length) return "Partly checked";
  if (!state.issues.length) return "No issues found";
  return `${state.issues.length}${state.complete ? "" : "+"} issue${state.issues.length === 1 ? "" : "s"}`;
}
export const reviewStyle = `
:host{all:initial;color-scheme:light dark;font:14px/20px system-ui,sans-serif}
*{box-sizing:border-box}[hidden]{display:none!important}
.review{--paper:light-dark(#fff,#222624);--ink:light-dark(#212722,#edf2e8);--quiet:light-dark(#535c55,#b5c3b4);--edge:light-dark(#dce2dc,#465446);--spell:light-dark(#b42318,#ffb4ab);--grammar:light-dark(#9a4d00,#ffd08a);--clean:light-dark(#24633b,#b6d5ad);background:var(--paper);color:var(--ink);font:14px/20px system-ui,sans-serif;display:flex;flex-direction:column;min-height:0;max-height:100%;text-align:start}
.review button{font:inherit;color:inherit;min-height:32px;padding:6px 8px;border:0;border-radius:4px;background:transparent;cursor:pointer;overflow-wrap:anywhere;text-align:start}
.review button:hover{background:light-dark(#edf0ec,#343c36)}
.review button:focus-visible,.review input:focus-visible,.review summary:focus-visible,.review-list:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.review-head{display:flex;align-items:center;gap:8px;min-height:32px;flex:none}
.review-title{font-size:15px;font-weight:600;flex:1;min-width:0}
.review .review-close{font-size:20px;text-align:center;width:32px;padding:4px;flex:none}
.review-summary{margin:4px 0 8px;color:var(--quiet);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.review-filters{display:flex;gap:4px;flex-wrap:wrap;padding-bottom:8px;flex:none}
.review .filter{font-size:12px;padding:4px 8px;border-radius:0;border-bottom:2px solid transparent}
.review .filter[aria-pressed=true]{border-bottom-color:var(--ink)}
.review-list{overflow:auto;overscroll-behavior:contain;min-height:0;flex:1;padding:2px 4px 2px 2px;scroll-padding:8px}
.issue-row{position:relative;padding:4px 0 8px;margin:0 0 4px}
.review .issue-label{width:100%;padding:4px 0;min-height:32px;line-height:20px}
.issue-original{overflow-wrap:anywhere;white-space:pre-wrap;text-decoration:underline dotted var(--grammar);text-underline-offset:3px}.spelling .issue-original{text-decoration:underline wavy var(--spell)}
.issue-kind{display:block;color:var(--grammar);font-size:12px;margin-top:2px;line-height:18px}.spelling .issue-kind{color:var(--spell)}
.issue-detail{padding:4px 0 8px}
.issue-explanation{font-size:13px;line-height:20px;margin:8px 0;color:var(--quiet)}
.issue-choices{display:grid;gap:4px}
.issue-suggestions summary{cursor:pointer;list-style:none;min-height:32px;padding:6px 0;font-size:12px;text-decoration:underline;text-underline-offset:3px}.issue-suggestions[open]{display:grid;gap:4px}
.review .replacement{background:light-dark(#edf0ec,#343c36);min-height:36px;padding:8px 10px;font-weight:500;white-space:pre-wrap}
.issue-actions{display:flex;gap:8px;align-items:start;flex-wrap:wrap;margin-top:8px}
.issue-actions details{position:relative}.issue-actions summary,.review-more summary{list-style:none;cursor:pointer;min-height:32px;padding:6px 8px}
.issue-actions details[open],.review-more[open]{padding-bottom:4px}
.issue-actions details button,.review-more button{display:block;width:100%}
.review-footer{display:flex;align-items:center;gap:8px;justify-content:space-between;border-top:1px solid var(--edge);margin-top:8px;padding-top:8px;flex:none;font-size:12px}
.review-toggle{display:flex;gap:8px;align-items:center;min-height:32px;cursor:pointer}
.review-toggle input{appearance:none;border:1px solid var(--quiet);border-radius:12px;background:var(--paper);width:28px;height:18px;flex:none;margin:0;position:relative;cursor:pointer}.review-toggle input::before{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--quiet)}.review-toggle input:checked{background:var(--ink);border-color:var(--ink)}.review-toggle input:checked::before{left:12px;background:var(--paper)}
.review-empty{color:var(--quiet);padding:12px 6px;margin:0;font-size:13px}
.review-feedback{min-height:20px;font-size:12px;margin:4px 0 0;color:var(--quiet)}
.review-feedback:empty{display:none}
@media(pointer:coarse){.review button,.review summary,.review-toggle{min-height:44px}}
@media(forced-colors:active){.review{border:1px solid CanvasText}.review-toggle input{appearance:auto}.review-toggle input::before{display:none}}
`;

/** Shared local review surface; no network, storage, draft reads or implicit edits. */
export class WritingReview {
  readonly element = document.createElement("section");
  private title = document.createElement("strong");
  private summary = document.createElement("p");
  private filters = document.createElement("div");
  private body = document.createElement("div");
  private toggle = document.createElement("input");
  private feedback = document.createElement("p");
  private empty = document.createElement("p");
  private state: ReviewState | null = null;
  private filter = "all";
  private selected: string | undefined;
  private rows = new Map<string, HTMLElement>();
  private signature = "";
  constructor(
    private options: {
      action: (action: ReviewAction) => void;
      close?: () => void;
      settings?: () => void;
      sidebar?: () => void;
      reveal?: (issue: WritingIssue) => void;
    },
  ) {
    this.element.className = "review";
    const header = document.createElement("header");
    header.className = "review-head";
    this.title.className = "review-title";
    header.append(this.title);
    if (options.close) {
      const close = this.button("×", options.close, "review-close");
      close.setAttribute("aria-label", "Close writing suggestions");
      header.append(close);
    }
    this.summary.className = "review-summary";
    this.filters.className = "review-filters";
    for (const [value, label] of [
      ["all", "All"],
      ["spelling", "Spelling"],
      ["grammar", "Grammar"],
    ]) {
      const button = this.button(
        label,
        () => {
          this.filter = value;
          this.renderRows();
        },
        "filter",
      );
      button.dataset.filter = value;
      this.filters.append(button);
    }
    this.body.className = "review-list";
    this.body.tabIndex = 0;
    this.body.setAttribute("aria-label", "Writing issues");
    this.empty.className = "review-empty";
    this.toggle.type = "checkbox";
    this.toggle.setAttribute("role", "switch");
    this.toggle.setAttribute("aria-label", "Checking in this field");
    this.toggle.addEventListener("change", (event) => {
      if (event.isTrusted) this.run(this.toggle.checked ? "resume" : "pause");
    });
    const label = document.createElement("label");
    label.className = "review-toggle";
    label.append(this.toggle, "Checking in this field");
    const footer = document.createElement("footer");
    footer.className = "review-footer";
    footer.append(label);
    if (options.settings || options.sidebar) {
      const more = document.createElement("details");
      more.className = "review-more";
      const summary = document.createElement("summary");
      summary.textContent = "More";
      more.append(summary);
      if (options.sidebar)
        more.append(this.button("Open in sidebar", options.sidebar));
      if (options.settings)
        more.append(this.button("Writing settings", options.settings));
      footer.append(more);
    }
    this.feedback.className = "review-feedback";
    this.feedback.setAttribute("role", "status");
    this.element.append(
      header,
      this.summary,
      this.filters,
      this.body,
      footer,
      this.feedback,
    );
    this.set(null);
  }
  private button(label: string, run: () => void, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", (event) => {
      if (event.isTrusted) run();
    });
    return button;
  }
  private run(
    action: ReviewAction["action"],
    issueId?: string,
    replacement?: string,
  ) {
    if (this.state)
      this.options.action({
        editorId: this.state.editorId,
        revision: this.state.revision,
        action,
        ...(issueId ? { issueId } : {}),
        ...(replacement !== undefined ? { replacement } : {}),
      });
  }
  set(state: ReviewState | null) {
    if (state?.editorId !== this.state?.editorId) {
      this.selected = undefined;
      this.filter = "all";
      this.rows.clear();
      this.body.replaceChildren();
    }
    this.state = state;
    this.title.textContent = state
      ? reviewSummary(state)
      : "Choose a text field";
    const spelling =
      state?.issues.filter((issue) => issue.rule === "spelling").length ?? 0;
    const grammar = (state?.issues.length ?? 0) - spelling;
    this.summary.textContent = !state
      ? "Select a supported field on the page to review its writing."
      : state.phase === "ready"
        ? `${spelling} spelling, ${grammar} grammar${!state.spelling ? "; spelling off" : ""}${!state.grammar ? "; grammar off" : ""}${!state.complete ? ". Checked part of this field; more text is unchecked." : ""}`
        : state.phase === "paused"
          ? "Checks are paused only in this field."
          : state.phase === "failed"
            ? "Writing check failed. Try again."
            : state.phase === "disabled"
              ? "Enable spelling or grammar in Writing settings."
              : "Spelling and grammar stay on your device.";
    this.toggle.checked = !!state && state.phase !== "paused";
    this.toggle.disabled = !state || state.phase === "disabled";
    this.feedback.textContent = state?.feedback ?? "";
    this.filters.hidden =
      !state || state.phase !== "ready" || !state.issues.length;
    for (const button of this.filters.querySelectorAll<HTMLButtonElement>(
      "button",
    )) {
      const key = button.dataset.filter!;
      button.textContent = `${key === "all" ? "All" : key === "spelling" ? "Spelling" : "Grammar"} ${key === "all" ? spelling + grammar : key === "spelling" ? spelling : grammar}`;
    }
    this.renderRows();
  }
  select(issueId?: string) {
    this.selected = issueId;
    this.signature = "";
    this.renderRows();
  }
  private renderRows() {
    for (const button of this.filters.querySelectorAll<HTMLButtonElement>(
      "button",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.filter === this.filter),
      );
    const state = this.state;
    const issues =
      state?.phase === "ready"
        ? state.issues.filter(
            (issue) =>
              this.filter === "all" || issueCategory(issue) === this.filter,
          )
        : [];
    const signature = JSON.stringify([
      state?.editorId,
      state?.revision,
      state?.phase,
      issues,
      this.selected,
      this.filter,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    const active = this.element.getRootNode() as Document | ShadowRoot;
    const focused = active.activeElement as HTMLElement | null;
    const focusKey = focused?.dataset.actionKey;
    const focusedRow = focused?.closest(".issue-row");
    const focusedIndex = focusedRow
      ? [...this.body.children].indexOf(focusedRow)
      : -1;
    const scroll = this.body.scrollTop;
    const keep = new Set(issues.map((issue) => issue.id));
    for (const [id, row] of this.rows)
      if (!keep.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    this.empty.remove();
    for (const [issueIndex, issue] of issues.entries()) {
      let row = this.rows.get(issue.id);
      if (!row) {
        row = document.createElement("article");
        row.className = `issue-row ${issueCategory(issue)}`;
        this.rows.set(issue.id, row);
        this.body.append(row);
      }
      const at = this.body.children.item(issueIndex);
      if (at !== row) this.body.insertBefore(row, at);
      const current = JSON.stringify([issue, this.selected === issue.id]);
      if (row.dataset.render === current) continue;
      row.dataset.render = current;
      row.replaceChildren();
      const label = this.button(
        `${issue.original} — ${issueCategory(issue) === "spelling" ? "Spelling" : "Grammar"}`,
        () => {
          this.selected = issue.id;
          this.renderRows();
          this.options.reveal?.(issue);
          row!
            .querySelector<HTMLButtonElement>(".replacement")
            ?.focus({ preventScroll: true });
        },
        "issue-label",
      );
      label.dataset.original = issue.original;
      label.dataset.category = issueCategory(issue);
      label.setAttribute(
        "aria-description",
        `Issue ${issueIndex + 1} of ${issues.length}.`,
      );
      const original = document.createElement("span");
      original.className = "issue-original";
      original.textContent = issue.original;
      const kind = document.createElement("span");
      kind.className = "issue-kind";
      kind.textContent =
        issueCategory(issue) === "spelling" ? "Spelling" : "Grammar";
      label.replaceChildren(
        document.createTextNode(issue.before ?? ""),
        original,
        document.createTextNode(issue.after ?? ""),
        kind,
      );
      label.dataset.actionKey = `issue:${issue.id}`;
      label.setAttribute("aria-expanded", String(this.selected === issue.id));
      row.append(label);
      if (this.selected !== issue.id) continue;
      const detail = document.createElement("div");
      detail.className = "issue-detail";
      const choices = document.createElement("div");
      choices.className = "issue-choices";
      for (const replacement of issue.replacements.slice(0, 1)) {
        const button = this.button(
          state?.canApply
            ? replacement || "Remove"
            : `Copy ${replacement || "correction"}`,
          () => this.run("apply", issue.id, replacement),
          "replacement",
        );
        button.title = `Replace “${issue.original}” with “${replacement}”`;
        button.dataset.actionKey = `replace:${issue.id}:${replacement}`;
        choices.append(button);
      }
      if (issue.replacements.length > 1) {
        const alternatives = document.createElement("details"),
          summary = document.createElement("summary");
        alternatives.className = "issue-suggestions";
        summary.textContent = "Other suggestions";
        alternatives.append(summary);
        for (const replacement of issue.replacements.slice(1))
          alternatives.append(
            this.button(
              state?.canApply
                ? replacement || "Remove"
                : `Copy ${replacement || "correction"}`,
              () => this.run("apply", issue.id, replacement),
              "replacement",
            ),
          );
        choices.append(alternatives);
      }
      const explanation = document.createElement("p");
      explanation.className = "issue-explanation";
      explanation.textContent = englishMessages[issue.message];
      const actions = document.createElement("div");
      actions.className = "issue-actions";
      actions.append(
        this.button("All issues", () => {
          this.selected = undefined;
          this.renderRows();
          label.focus({ preventScroll: true });
        }),
        this.button("Ignore", () => this.run("ignore", issue.id)),
      );
      if (issue.rule === "spelling") {
        const more = document.createElement("details"),
          summary = document.createElement("summary");
        summary.textContent = "More";
        more.append(summary);
        more.append(
          this.button("Add to dictionary", () => this.run("word", issue.id)),
        );
        actions.append(more);
      }
      if (!issue.replacements.length)
        choices.textContent = "No alternative found.";
      detail.append(choices, explanation, actions);
      row.append(detail);
    }
    if (!issues.length) {
      this.empty.replaceChildren();
      this.empty.append(
        !state
          ? "No field selected."
          : state.phase === "ready"
            ? state.complete
              ? this.filter === "all"
                ? "No issues found."
                : `No ${this.filter} issues.`
              : "No issues in the checked portion. More text is unchecked."
            : state.phase === "paused"
              ? "Turn checking on to check this field again."
              : state.phase === "checking"
                ? "Checking this field…"
                : "",
      );
      if (state && (state.phase === "idle" || state.phase === "failed"))
        this.empty.append(
          this.button(
            state.phase === "failed" ? "Retry" : "Check writing",
            () => this.run("check"),
          ),
        );
      this.body.append(this.empty);
    }
    this.body.scrollTop = scroll;
    if (focusKey && !focused?.isConnected)
      this.element
        .querySelectorAll<HTMLElement>("[data-action-key]")
        .forEach((node) => {
          if (node.dataset.actionKey === focusKey)
            node.focus({ preventScroll: true });
        });
    if (
      focusedIndex >= 0 &&
      !focused?.isConnected &&
      !this.element.contains(active.activeElement)
    ) {
      const rows = [
        ...this.body.querySelectorAll<HTMLButtonElement>(".issue-label"),
      ];
      (rows[Math.min(focusedIndex, rows.length - 1)] ?? this.body).focus({
        preventScroll: true,
      });
    }
  }
}
