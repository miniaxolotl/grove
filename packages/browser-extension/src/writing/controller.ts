import {
  mapIgnoredIssues,
  eligibleEditor,
  type WritingIssue,
  type WritingResult,
  type WritingSettings,
} from "./core.ts";
import { isWritingEditor, editorMetadata } from "./editor.ts";
import { WritingAdapter, type EditorSnapshot } from "./adapter.ts";
import { copyWritingChoice, copyText } from "./clipboard.ts";
import {
  WritingToolsController,
  type WritingToolTransport,
} from "./tools-controller.ts";
import { PROOFING_CONTENT_MAX } from "@lib/shared/limits";
import {
  WritingReview,
  reviewStyle,
  reviewSummary,
  reviewActionSchema,
  type ReviewState,
  type ReviewAction,
} from "./review.ts";

const style = `${reviewStyle}
.mirror{position:fixed;pointer-events:none;overflow:hidden;color:transparent;z-index:2147483645}.text{white-space:pre-wrap;overflow-wrap:break-word;color:transparent}
mark{color:transparent;background:transparent;text-decoration:underline wavy light-dark(#b42318,#ffb4ab);text-underline-offset:3px}mark.grammar{text-decoration-style:dotted;text-decoration-color:light-dark(#9a4d00,#ffd08a)}
.card{position:fixed;z-index:2147483647;width:min(320px,calc(100vw - 24px));max-height:min(420px,calc(100dvh - 24px));padding:12px;border:1px solid light-dark(#dce2dc,#465446);border-radius:6px;background:light-dark(#fff,#222624);color:light-dark(#212722,#edf2e8);box-shadow:0 4px 12px #0001;overflow:hidden;display:flex;flex-direction:column}
.badge{--mark:light-dark(#535c55,#b5c3b4);position:fixed;z-index:2147483646;display:flex;gap:6px;align-items:center;justify-content:center;min-width:32px;min-height:32px;padding:4px 8px 6px 6px;border:0;border-radius:0;background:light-dark(#fff,#222624);color:light-dark(#212722,#edf2e8);font:12px/20px system-ui,sans-serif;cursor:pointer;font-variant-numeric:tabular-nums}
.badge-count{font-weight:600;min-width:1ch;text-align:center}.badge-label{font-weight:400}
.badge::after{content:'';position:absolute;bottom:4px;right:3px;width:10px;border-bottom:2px solid var(--mark)}
.proof-edge{position:absolute;right:3px;bottom:4px;display:flex;flex-direction:column;height:14px;width:2px;background:var(--mark)}.proof-edge span{flex:1}
.badge[data-kind=spelling]{--mark:light-dark(#b42318,#ffb4ab)}.badge[data-kind=grammar]{--mark:light-dark(#9a4d00,#ffd08a)}.badge[data-kind=clean]{--mark:light-dark(#24633b,#b6d5ad)}
.badge[data-kind=mixed] .proof-edge span:first-child{background:light-dark(#b42318,#ffb4ab)}.badge[data-kind=mixed] .proof-edge span:last-child{background:light-dark(#9a4d00,#ffd08a)}
.badge[data-kind=mixed]::after{border-bottom-color:light-dark(#9a4d00,#ffd08a)}
.badge.compact .badge-label{display:none}.badge:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
@media(pointer:coarse){.badge{min-width:44px;min-height:44px}}
@media(forced-colors:active){mark{color:transparent;text-decoration-color:Mark}.badge{border:1px solid ButtonText}.proof-edge{background:ButtonText}.card{border-color:CanvasText}}
`;

/** One focused editor. Checking, presentation and field pause have separate lifecycles. */
export class WritingController {
  readonly editorId = crypto.randomUUID();
  private host = document.createElement("div");
  private shadow = this.host.attachShadow({ mode: "open" });
  private mirror = document.createElement("div");
  private text = document.createElement("div");
  private card = document.createElement("section");
  private badge = document.createElement("button");
  private count = document.createElement("span");
  private badgeLabel = document.createElement("span");
  private reviewView: WritingReview;
  private adapter: WritingAdapter;
  private snapshot: EditorSnapshot | undefined;
  private result: WritingResult | null = null;
  private ignored = new Map<string, WritingIssue>();
  private previousText = "";
  private pending: Promise<WritingResult> | undefined;
  private epoch = 0;
  private phase: ReviewState["phase"] = "idle";
  private paused = false;
  private compact = false;
  private feedback = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private composing = false;
  private frame: number | undefined;
  private events = new AbortController();
  private observer: MutationObserver;
  private resize: ResizeObserver;
  private tools: WritingToolsController | undefined;
  private highlights = `grove-writing-${this.editorId}`;
  private highlightSheet: CSSStyleSheet | undefined;
  private placement: string | undefined;
  private returnTo: HTMLElement;
  constructor(
    private editor: HTMLElement,
    private options: {
      settings: () => WritingSettings;
      check: (text: string) => Promise<WritingResult>;
      addWord: (word: string) => Promise<void>;
      status: (result: WritingResult | null, error?: string) => void;
      tools?: WritingToolTransport;
      feedback?: (message: string) => void;
      indicator?: boolean;
      changed?: () => void;
      settingsAction?: () => void;
      sidebarAction?: () => void;
    },
  ) {
    this.adapter = new WritingAdapter(editor);
    this.returnTo = editor;
    this.host.dataset.groveWritingUi = "true";
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style);
    this.shadow.adoptedStyleSheets = [sheet];
    this.mirror.className = "mirror";
    this.mirror.setAttribute("aria-hidden", "true");
    this.text.className = "text";
    this.mirror.append(this.text);
    this.card.className = "card";
    this.card.hidden = true;
    this.card.id = `review-${this.editorId}`;
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "Writing suggestions");
    this.reviewView = new WritingReview({
      action: (action) => {
        void this.action(action);
      },
      close: () => this.close(),
      settings: options.settingsAction,
      sidebar: options.sidebarAction,
      reveal: (issue) => this.reveal(issue),
    });
    this.card.append(this.reviewView.element);
    this.badge.type = "button";
    this.badge.dataset.groveWritingUi = "true";
    this.badge.className = "badge";
    this.badge.hidden = true;
    this.badge.setAttribute("aria-haspopup", "dialog");
    this.badge.setAttribute("aria-controls", this.card.id);
    this.badge.setAttribute("aria-expanded", "false");
    this.count.className = "badge-count";
    this.badgeLabel.className = "badge-label";
    const edge = document.createElement("span");
    edge.className = "proof-edge";
    edge.setAttribute("aria-hidden", "true");
    edge.append(document.createElement("span"), document.createElement("span"));
    this.badge.append(this.count, this.badgeLabel, edge);
    this.badge.addEventListener("click", (event) => {
      if (event.isTrusted) this.reviewOpen();
    });
    this.shadow.append(this.mirror, this.badge, this.card);
    document.body.append(this.host);
    const event = { signal: this.events.signal };
    editor.addEventListener(
      "input",
      () => {
        this.compact = true;
        this.changed();
      },
      event,
    );
    editor.addEventListener(
      "compositionstart",
      () => {
        this.compact = true;
        this.composing = true;
        this.invalidate();
      },
      event,
    );
    editor.addEventListener(
      "compositionend",
      () => {
        this.composing = false;
        this.changed();
      },
      event,
    );
    editor.addEventListener(
      "focus",
      () => {
        if (options.settings().automatic && !this.paused) this.changed();
      },
      event,
    );
    editor.addEventListener(
      "click",
      () => {
        if (
          !this.allowed() ||
          !this.result ||
          !this.snapshot ||
          this.snapshot.text !== this.adapter.read().text
        )
          return;
        const at = this.adapter.selection(this.snapshot);
        const issue =
          at && at.from === at.to
            ? this.issues().find(
                (issue) => issue.from <= at.from && at.from <= issue.to,
              )
            : undefined;
        if (issue) this.reviewOpen(issue);
      },
      event,
    );
    editor.addEventListener(
      "keydown",
      (event) => {
        if (event.altKey && event.key === "Enter" && !event.isComposing) {
          const control = this.adapter.control;
          if (
            !this.tools ||
            !control ||
            control.selectionStart === control.selectionEnd ||
            !options.settings().aiRewrites ||
            !options.tools?.availability().available ||
            !options.tools.availability().authorized ||
            !eligibleEditor(editorMetadata(editor))
          ) {
            event.preventDefault();
            this.reviewOpen();
          }
        }
        if (event.key === "Escape") this.close(false);
      },
      event,
    );
    this.card.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        const focused = this.shadow.activeElement as HTMLElement | null;
        const open =
          focused?.closest<HTMLDetailsElement>("details[open]") ??
          [
            ...this.card.querySelectorAll<HTMLDetailsElement>("details[open]"),
          ].at(-1);
        if (open) {
          open.open = false;
          open.querySelector("summary")?.focus();
        } else this.close();
      },
      event,
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.composedPath().includes(this.host)) this.close(false);
      },
      event,
    );
    editor.addEventListener("scroll", () => this.schedulePosition(), event);
    window.addEventListener("resize", () => this.schedulePosition(), event);
    window.visualViewport?.addEventListener(
      "resize",
      () => this.schedulePosition(),
      event,
    );
    window.visualViewport?.addEventListener(
      "scroll",
      () => this.schedulePosition(),
      event,
    );
    document.addEventListener("scroll", () => this.schedulePosition(), {
      ...event,
      capture: true,
      passive: true,
    });
    this.observer = new MutationObserver(() => {
      if (!this.allowed()) this.placement = undefined;
      if (!this.eligible()) this.invalidate();
      else if (
        this.allowed() &&
        !this.adapter.control &&
        (this.snapshot?.text ?? this.previousText) !== this.adapter.read().text
      )
        this.changed();
      else this.schedulePosition();
    });
    this.observer.observe(editor, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "spellcheck",
        "contenteditable",
        "aria-label",
        "aria-labelledby",
        "autocomplete",
        "type",
        "hidden",
        "aria-hidden",
        "style",
        "class",
        "role",
        "inert",
        "readonly",
        "disabled",
        "aria-readonly",
        "aria-disabled",
        "name",
        "id",
      ],
    });
    this.resize = new ResizeObserver(() => this.schedulePosition());
    this.resize.observe(editor);
    this.resize.observe(this.card);
    // New local adapters do not silently expand the consented AI selection surface.
    if (options.tools && editor instanceof HTMLTextAreaElement)
      this.tools = new WritingToolsController(
        editor,
        () => ({ ...options.settings(), enabled: this.allowed() }),
        options.tools,
        () => this.close(false),
        options.feedback,
      );
    this.emit();
  }
  private eligible() {
    return this.options.settings().enabled && isWritingEditor(this.editor);
  }
  private allowed() {
    return !this.paused && this.eligible() && !this.events.signal.aborted;
  }
  private issues() {
    return (this.result?.issues ?? []).filter(
      (issue) =>
        !this.ignored.has(`${issue.rule}:${issue.from}:${issue.original}`),
    );
  }
  state(): ReviewState | null {
    if (!this.eligible() || this.events.signal.aborted) return null;
    const settings = this.options.settings();
    return {
      editorId: this.editorId,
      revision: this.epoch,
      phase: this.paused
        ? "paused"
        : !settings.spelling && !settings.grammar
          ? "disabled"
          : this.phase,
      spelling: settings.spelling,
      grammar: settings.grammar,
      complete: !!this.result?.complete,
      canApply: !!this.adapter.control || !!this.snapshot?.complete,
      issues:
        this.phase === "ready"
          ? this.issues().map((issue) => ({
              ...issue,
              ...this.context(issue),
            }))
          : [],
      ...(this.feedback ? { feedback: this.feedback } : {}),
    };
  }
  private context(issue: WritingIssue) {
    const text = this.snapshot?.text ?? "";
    let before = text.slice(Math.max(0, issue.from - 24), issue.from);
    let after = text.slice(issue.to, issue.to + 24);
    if (issue.from > 24) before = "…" + before.replace(/^\S*\s?/, "");
    if (issue.to + 24 < text.length) after = after.replace(/\S*$/, "") + "…";
    return { before, after };
  }
  private emit(error?: string) {
    const state = this.state();
    this.options.status(
      this.result && state?.phase === "ready"
        ? { ...this.result, issues: this.issues() }
        : null,
      error,
    );
    this.reviewView.set(state);
    this.badge.hidden = !this.options.indicator || !state;
    if (state) {
      const ready = state.phase === "ready",
        count = state.issues.length;
      this.count.textContent = ready
        ? count
          ? `${Math.min(count, 99)}${count > 99 || !state.complete ? "+" : ""}`
          : state.complete
            ? "0"
            : "◐"
        : state.phase === "paused"
          ? "⏻"
          : state.phase === "checking"
            ? "…"
            : state.phase === "failed"
              ? "!"
              : "–";
      this.badgeLabel.textContent =
        ready && count
          ? `issue${count === 1 ? "" : "s"}`
          : reviewSummary(state);
      const spelling = state.issues.some((issue) => issue.rule === "spelling"),
        grammar = state.issues.some((issue) => issue.rule !== "spelling");
      this.badge.dataset.kind =
        !ready || !state.complete
          ? "neutral"
          : !count
            ? "clean"
            : spelling && grammar
              ? "mixed"
              : spelling
                ? "spelling"
                : "grammar";
      const label = `${reviewSummary(state)}. ${state.issues.filter((issue) => issue.rule === "spelling").length} spelling, ${state.issues.filter((issue) => issue.rule !== "spelling").length} grammar.${ready && !state.complete ? " More text is unchecked." : ""} Review this field.`;
      this.badge.title = label;
      this.badge.setAttribute("aria-label", label);
      this.badge.classList.toggle("compact", this.compact);
    }
    this.schedulePosition();
    this.options.changed?.();
  }
  private invalidate() {
    this.epoch++;
    clearTimeout(this.timer);
    this.result = null;
    this.snapshot = undefined;
    this.text.textContent = this.allowed() ? this.previousText + "\n" : "";
    this.clearHighlights();
    this.close(false);
    this.phase = "idle";
    this.feedback = "";
    this.emit();
  }
  private changed() {
    this.placement = undefined;
    if (
      this.allowed() &&
      (this.options.settings().spelling || this.options.settings().grammar)
    ) {
      const text = this.adapter.read().text.slice(0, PROOFING_CONTENT_MAX);
      if (this.ignored.size)
        this.ignored = new Map(
          mapIgnoredIssues(this.previousText, text, [
            ...this.ignored.values(),
          ]).map((issue) => [
            `${issue.rule}:${issue.from}:${issue.original}`,
            issue,
          ]),
        );
      this.previousText = text;
    } else {
      this.ignored.clear();
      this.previousText = "";
    }
    this.invalidate();
    if (this.allowed() && !this.composing && this.options.settings().automatic)
      this.timer = setTimeout(() => {
        void this.check();
      }, 350);
  }
  refresh() {
    this.tools?.refresh();
    this.changed();
  }
  refreshTools() {
    this.tools?.refresh();
  }
  async check() {
    this.invalidate();
    if (!this.allowed() || this.composing) return;
    const epoch = this.epoch;
    if (this.pending) await this.pending.catch(() => undefined);
    if (epoch !== this.epoch || !this.allowed() || this.composing) return;
    const settings = this.options.settings();
    if (!settings.spelling && !settings.grammar) return;
    const snapshot = this.adapter.read();
    if (!snapshot.text.trim()) return;
    this.text.textContent = snapshot.text.slice(0, PROOFING_CONTENT_MAX) + "\n";
    this.phase = "checking";
    this.emit();
    const pending = this.options.check(snapshot.text);
    this.pending = pending;
    try {
      const result = await pending;
      if (
        epoch !== this.epoch ||
        !this.allowed() ||
        snapshot.text !== this.adapter.read().text
      )
        return;
      this.snapshot = this.adapter.read();
      this.result = {
        ...result,
        complete:
          result.complete &&
          snapshot.complete &&
          snapshot.text.length <= PROOFING_CONTENT_MAX,
      };
      this.phase = "ready";
      this.render();
      this.emit();
    } catch {
      if (epoch === this.epoch) {
        this.phase = "failed";
        this.emit("Writing check failed. Try again.");
      }
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }
  private render() {
    this.text.textContent =
      (this.snapshot?.text.slice(0, PROOFING_CONTENT_MAX) ?? "") + "\n";
    this.clearHighlights();
    if (
      !this.result ||
      !this.snapshot ||
      !this.allowed() ||
      !this.options.settings().highlights
    )
      return;
    if (!this.adapter.control) {
      if (typeof Highlight === "undefined" || !CSS.highlights) return;
      for (const category of ["spelling", "grammar"]) {
        const ranges = this.issues()
          .filter(
            (issue) =>
              (issue.rule === "spelling" ? "spelling" : "grammar") === category,
          )
          .map((issue) => this.snapshot!.range(issue.from, issue.to))
          .filter((range): range is Range => !!range);
        CSS.highlights.set(
          `${this.highlights}-${category}`,
          new Highlight(...ranges),
        );
      }
      if (!this.highlightSheet) {
        this.highlightSheet = new CSSStyleSheet();
        this.highlightSheet.replaceSync(
          `::highlight(${this.highlights}-spelling){text-decoration:underline wavy light-dark(#b42318,#ffb4ab);text-underline-offset:3px}::highlight(${this.highlights}-grammar){text-decoration:underline dotted light-dark(#9a4d00,#ffd08a);text-underline-offset:3px}`,
        );
        const root = this.editor.getRootNode() as Document | ShadowRoot;
        root.adoptedStyleSheets = [
          ...root.adoptedStyleSheets,
          this.highlightSheet,
        ];
      }
      return;
    }
    this.text.replaceChildren();
    let at = 0;
    for (const issue of this.issues()) {
      if (issue.from < at) continue;
      this.text.append(
        document.createTextNode(this.snapshot.text.slice(at, issue.from)),
      );
      const mark = document.createElement("mark");
      mark.className = issue.rule === "spelling" ? "spelling" : "grammar";
      mark.dataset.issue = issue.id;
      mark.textContent = issue.original;
      this.text.append(mark);
      at = issue.to;
    }
    this.text.append(
      document.createTextNode(
        this.snapshot.text.slice(at, this.result.checkedTo) + "\n",
      ),
    );
    this.position();
  }
  private clearHighlights() {
    if (typeof CSS !== "undefined" && CSS.highlights)
      for (const category of ["spelling", "grammar"])
        CSS.highlights.delete(`${this.highlights}-${category}`);
  }
  private schedulePosition() {
    if (this.frame !== undefined || this.events.signal.aborted) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.position();
    });
  }
  private position() {
    const rect = this.editor.getBoundingClientRect(),
      computed = getComputedStyle(this.editor);
    if (computed.colorScheme !== "normal")
      this.host.style.colorScheme = computed.colorScheme;
    Object.assign(this.mirror.style, {
      left: `${rect.left + this.editor.clientLeft}px`,
      top: `${rect.top + this.editor.clientTop}px`,
      width: `${this.editor.clientWidth}px`,
      height: `${this.editor.clientHeight}px`,
    });
    for (const key of [
      "font",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "fontVariant",
      "lineHeight",
      "letterSpacing",
      "wordSpacing",
      "textIndent",
      "textAlign",
      "tabSize",
      "direction",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ] as const)
      this.text.style[key] = computed[key];
    this.text.style.whiteSpace =
      this.editor instanceof HTMLInputElement ? "pre" : "pre-wrap";
    const inputOffset =
      this.editor instanceof HTMLInputElement
        ? Math.max(
            0,
            (this.editor.clientHeight -
              this.text.getBoundingClientRect().height) /
              2,
          )
        : 0;
    this.text.style.transform = `translate(${-this.editor.scrollLeft}px, ${inputOffset - this.editor.scrollTop}px)`;
    if (this.options.indicator && this.state()) {
      this.badge.hidden = false;
      const width = this.badge.getBoundingClientRect().width,
        height = this.badge.getBoundingClientRect().height;
      const content = {
        left: rect.left + this.editor.clientLeft,
        top: rect.top + this.editor.clientTop,
        right: rect.left + this.editor.clientLeft + this.editor.clientWidth,
        bottom: rect.top + this.editor.clientTop + this.editor.clientHeight,
      };
      const resizeInset =
        this.editor instanceof HTMLTextAreaElement && computed.resize !== "none"
          ? 18
          : 6;
      const left = content.right - width - resizeInset;
      const top =
        this.editor instanceof HTMLInputElement
          ? content.top + (this.editor.clientHeight - height) / 2
          : content.bottom - height - 6;
      const key = [
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        this.editor.clientWidth,
        this.editor.clientHeight,
        this.editor.scrollTop,
        this.editor.scrollLeft,
        computed.font,
        computed.padding,
        computed.direction,
        width,
        height,
      ].join(":");
      // Pausing never reads field text just to draw UI. Reuse only a placement
      // already verified for this geometry; edits/DOM changes clear that proof.
      let safe = this.placement === key;
      if (
        this.allowed() &&
        (this.options.settings().spelling || this.options.settings().grammar)
      ) {
        const control = this.adapter.control;
        const projection = control ? undefined : this.adapter.read();
        const range = document.createRange();
        range.selectNodeContents(this.text);
        const occupied = control
          ? [...range.getClientRects()]
          : (projection?.rects?.() ?? []);
        if (control) {
          const cursor = control.selectionEnd ?? 0;
          const walker = document.createTreeWalker(
            this.text,
            NodeFilter.SHOW_TEXT,
          );
          let offset = cursor,
            node: Node | null;
          while ((node = walker.nextNode())) {
            const length = node.nodeValue?.length ?? 0;
            if (offset <= length) {
              range.setStart(node, offset);
              range.collapse(true);
              occupied.push(...range.getClientRects());
              break;
            }
            offset -= length;
          }
        } else {
          const selection = document.getSelection();
          if (
            selection?.rangeCount &&
            this.editor.contains(selection.anchorNode)
          )
            occupied.push(...selection.getRangeAt(0).getClientRects());
        }
        const known = control
          ? control.value.length <= PROOFING_CONTENT_MAX ||
            (!(control instanceof HTMLInputElement) &&
              this.text.getBoundingClientRect().bottom >= content.bottom)
          : projection?.complete ||
            occupied.some((box) => box.bottom >= content.bottom);
        safe =
          !!known &&
          !occupied.some(
            (box) =>
              box.height > 0 &&
              left < box.right + 3 &&
              left + width > box.left - 3 &&
              top < box.bottom + 3 &&
              top + height > box.top - 3,
          );
      }
      const hit = (x: number, y: number) => {
        let node = document.elementFromPoint(x, y);
        while (node?.shadowRoot) {
          const child = node.shadowRoot.elementFromPoint(x, y);
          if (!child || child === node) break;
          node = child;
        }
        return (
          !!node &&
          (node === this.editor ||
            this.editor.contains(node) ||
            this.shadow.contains(node))
        );
      };
      safe =
        !!safe &&
        Math.abs(rect.width - this.editor.offsetWidth) < 2 &&
        Math.abs(rect.height - this.editor.offsetHeight) < 2 &&
        left >= rect.left + 2 &&
        top >= rect.top + 2 &&
        left + width <= rect.right - 2 &&
        top + height <= rect.bottom - 2 &&
        left >= content.left + 2 &&
        top >= content.top + 2 &&
        left + width <= content.right - 2 &&
        top + height <= content.bottom - 2 &&
        left >= 0 &&
        top >= 0 &&
        left + width <= innerWidth &&
        top + height <= innerHeight &&
        [
          [left + 1, top + 1],
          [left + width - 1, top + 1],
          [left + 1, top + height - 1],
          [left + width - 1, top + height - 1],
        ].every(([x, y]) => hit(x, y));
      this.badge.hidden = !safe;
      this.placement = safe ? key : undefined;
      this.badge.style.left = `${left}px`;
      this.badge.style.top = `${top}px`;
    }
    if (!this.card.hidden) {
      const marker =
        this.snapshot && this.reviewIssue
          ? (this.snapshot
              .range(this.reviewIssue.from, this.reviewIssue.to)
              ?.getBoundingClientRect() ??
            this.text
              .querySelector<HTMLElement>(
                `mark[data-issue="${CSS.escape(this.reviewIssue.id)}"]`,
              )
              ?.getBoundingClientRect())
          : undefined;
      const anchor =
        marker &&
        marker.height &&
        marker.top >= rect.top &&
        marker.bottom <= rect.bottom
          ? marker
          : rect;
      const width = Math.min(320, innerWidth - 24),
        height = this.card.getBoundingClientRect().height;
      const below = innerHeight - anchor.bottom - 12,
        above = anchor.top - 12;
      const top =
        below >= Math.min(height, 200) || below >= above
          ? anchor.bottom + 6
          : Math.max(12, anchor.top - height - 6);
      this.card.style.left = `${Math.max(12, Math.min(anchor.right - width, innerWidth - width - 12))}px`;
      this.card.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
      this.card.style.maxHeight = `${Math.max(100, Math.min(420, below >= above ? below : above))}px`;
    }
  }
  private reviewIssue: WritingIssue | undefined;
  private reveal(issue: WritingIssue) {
    this.reviewIssue = issue;
    this.schedulePosition();
  }
  reviewOpen(issue?: WritingIssue) {
    this.tools?.close(false);
    if (!this.eligible() || this.composing) return;
    this.returnTo =
      this.shadow.activeElement === this.badge
        ? this.badge
        : document.activeElement instanceof HTMLButtonElement
          ? document.activeElement
          : this.editor;
    if (
      !this.paused &&
      (!this.result || this.snapshot?.text !== this.adapter.read().text) &&
      this.phase !== "checking"
    ) {
      if (this.phase === "ready") this.invalidate();
      void this.check();
    }
    this.reviewIssue = issue;
    this.reviewView.select(issue?.id);
    this.card.hidden = false;
    this.badge.setAttribute("aria-expanded", "true");
    this.position();
    (
      this.card.querySelector<HTMLElement>(".replacement") ??
      this.card.querySelector<HTMLElement>(".issue-label") ??
      this.card.querySelector<HTMLElement>(".review-list")
    )?.focus({ preventScroll: true });
  }
  // Kept for the panel's existing Check writing entry point.
  review(issue?: WritingIssue) {
    this.reviewOpen(issue);
  }
  async action(raw: ReviewAction, remote = false) {
    const action = reviewActionSchema.parse(raw);
    if (
      action.editorId !== this.editorId ||
      action.revision !== this.epoch ||
      !this.eligible() ||
      (remote && document.hidden)
    )
      return;
    if (action.action === "pause" || action.action === "resume") {
      const wasOpen = !this.card.hidden;
      this.paused = action.action === "pause";
      this.tools?.refresh();
      this.ignored.clear();
      this.previousText = "";
      this.invalidate();
      if (!this.paused) void this.check();
      this.card.hidden = !wasOpen;
      this.badge.setAttribute("aria-expanded", String(wasOpen));
      this.emit();
      return;
    }
    if (!this.allowed()) return;
    if (action.action === "check") {
      const wasOpen = !this.card.hidden;
      void this.check();
      this.card.hidden = !wasOpen;
      this.badge.setAttribute("aria-expanded", String(wasOpen));
      return;
    }
    const issue = this.issues().find((issue) => issue.id === action.issueId);
    if (
      !issue ||
      !this.snapshot ||
      this.snapshot.text !== this.adapter.read().text
    ) {
      this.changed();
      return;
    }
    if (action.action === "ignore") {
      this.ignored.set(`${issue.rule}:${issue.from}:${issue.original}`, issue);
      this.render();
      this.emit();
      return;
    }
    if (action.action === "word" && issue.rule === "spelling") {
      const epoch = this.epoch;
      try {
        await this.options.addWord(issue.original);
        if (epoch === this.epoch) this.refresh();
      } catch {
        if (epoch === this.epoch) {
          this.feedback = "Word could not be saved. Try again.";
          this.emit();
        }
      }
      return;
    }
    if (
      action.action !== "apply" ||
      action.replacement === undefined ||
      !issue.replacements.includes(action.replacement)
    )
      return;
    const snapshot = this.snapshot;
    if (!this.adapter.control && !snapshot.complete) {
      const epoch = this.epoch,
        ok = await copyText(action.replacement);
      if (epoch === this.epoch) {
        this.feedback = ok
          ? "Correction copied. Edit this field manually."
          : "Copy failed. Edit this field manually.";
        this.emit();
      }
      return;
    }
    if (
      !this.adapter.replace(snapshot, issue.from, issue.to, action.replacement)
    ) {
      this.feedback =
        "This editor could not apply the correction. Check the text before editing manually.";
      this.phase = "failed";
      this.emit();
      return;
    }
    this.close(false);
    this.changed();
    const epoch = this.epoch;
    copyWritingChoice(action.replacement, (message) => {
      if (epoch !== this.epoch || !this.eligible()) return;
      if (this.options.feedback) this.options.feedback(message);
      else {
        this.feedback = message;
        this.emit();
      }
    });
  }
  close(focus = true) {
    const open = !this.card.hidden;
    this.card.hidden = true;
    this.badge.setAttribute("aria-expanded", "false");
    if (focus && open && this.editor.isConnected)
      (this.returnTo.isConnected && this.returnTo.getClientRects().length
        ? this.returnTo
        : this.editor
      ).focus({ preventScroll: true });
  }
  destroy() {
    this.tools?.destroy();
    this.invalidate();
    this.events.abort();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.resize.disconnect();
    this.clearHighlights();
    if (this.highlightSheet) {
      const root = this.editor.getRootNode() as Document | ShadowRoot;
      if ("adoptedStyleSheets" in root)
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
          (sheet) => sheet !== this.highlightSheet,
        );
    }
    this.host.remove();
  }
}
