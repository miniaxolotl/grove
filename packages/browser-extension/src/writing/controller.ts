import {
  applyWritingEdit,
  mapIgnoredIssues,
  englishMessages,
  type WritingIssue,
  type WritingResult,
  type WritingSettings,
} from "./core.ts";
import { isWritingEditor } from "./editor.ts";
import {
  WritingToolsController,
  type WritingToolTransport,
} from "./tools-controller.ts";

const style = `
:host { all: initial; font: 14px/1.5 system-ui,sans-serif; color-scheme:light dark; }
* { box-sizing:border-box; } [hidden] { display:none!important; }
.mirror { position:fixed; pointer-events:none; overflow:hidden; color:transparent; z-index:2147483645; }
.text { white-space:pre-wrap; overflow-wrap:break-word; color:transparent; }
mark { color:transparent; background:transparent; text-decoration-line:underline; text-decoration-style:wavy; text-decoration-color:#bf353b; text-underline-offset:3px; }
mark.grammar { text-decoration-style:dotted; text-decoration-color:light-dark(#32684b,#9bceab); }
.card { position:fixed; z-index:2147483647; margin:0; width:min(340px,calc(100vw - 24px)); max-height:min(420px,calc(100dvh - 24px)); overflow:auto; padding:14px; border:1px solid light-dark(#c5cec6,#59635b); border-radius:8px; background:light-dark(#fff,#202320); color:light-dark(#181d19,#edf1ed); box-shadow:0 8px 24px #0002; font:14px/1.5 system-ui,sans-serif; }
header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
strong { font-weight:600; } p { margin:8px 0 12px; } .actions { display:flex; flex-wrap:wrap; gap:6px; }
.replacements { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-height:40px; margin-bottom:8px; }
button { font:inherit; color:inherit; min-height:40px; padding:8px 10px; border:1px solid light-dark(#a2aca3,#6e7c70); border-radius:6px; background:light-dark(#fff,#202320); cursor:pointer; overflow-wrap:anywhere; }
button:hover { border-color:currentColor; } button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.replacement { background:light-dark(#e9eee9,#343d35); } .close { border-color:transparent; } .original { overflow-wrap:anywhere; }
@media (forced-colors:active) { mark { text-decoration-color:Mark; } .card { border:1px solid CanvasText; } }
`;

/** One bounded textarea controller; no persistence, network or automatic text mutation. */
export class WritingController {
  private host = document.createElement("div");
  private shadow = this.host.attachShadow({ mode: "open" });
  private mirror = document.createElement("div");
  private text = document.createElement("div");
  private card = document.createElement("section");
  private snapshot = "";
  private result: WritingResult | null = null;
  private ignored = new Map<string, WritingIssue>();
  private previousText = "";
  private suggestions = new Map<string, string[]>();
  private anchor: WritingIssue | undefined;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private composing = false;
  private frame: number | undefined;
  private events = new AbortController();
  private observer: MutationObserver;
  private resize: ResizeObserver;
  private tools: WritingToolsController | undefined;
  constructor(
    private editor: HTMLTextAreaElement,
    private options: {
      settings: () => WritingSettings;
      check: (text: string) => Promise<WritingResult>;
      suggest: (word: string) => Promise<string[]>;
      addWord: (word: string) => Promise<void>;
      status: (result: WritingResult | null, error?: string) => void;
      tools?: WritingToolTransport;
    },
  ) {
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
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "Writing suggestions");
    this.shadow.append(this.mirror, this.card);
    document.body.append(this.host);
    const event = { signal: this.events.signal };
    editor.addEventListener("input", () => this.changed(), event);
    editor.addEventListener(
      "compositionstart",
      () => {
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
        if (options.settings().automatic) this.changed();
      },
      event,
    );
    editor.addEventListener(
      "click",
      () => {
        if (!this.allowed() || !this.result || this.snapshot !== editor.value)
          return;
        const at = editor.selectionStart;
        const issue = this.issues().find(
          (issue) => issue.from <= at && at <= issue.to,
        );
        if (issue && editor.selectionStart === editor.selectionEnd)
          this.review(issue);
      },
      event,
    );
    editor.addEventListener(
      "keydown",
      (event) => {
        if (
          event.altKey &&
          event.key === "Enter" &&
          !event.isComposing &&
          (editor.selectionStart === editor.selectionEnd ||
            !options.tools ||
            !options.settings().aiRewrites)
        ) {
          event.preventDefault();
          this.review();
        }
        if (event.key === "Escape") this.close(false);
      },
      event,
    );
    this.card.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this.close();
        }
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
      if (!this.allowed()) this.invalidate();
      else this.schedulePosition();
    });
    this.observer.observe(editor, { attributes: true });
    this.resize = new ResizeObserver(() => this.schedulePosition());
    this.resize.observe(editor);
    if (options.tools)
      this.tools = new WritingToolsController(
        editor,
        options.settings,
        options.tools,
        () => this.close(false),
      );
  }
  private allowed() {
    return this.options.settings().enabled && isWritingEditor(this.editor);
  }
  private issues() {
    return (this.result?.issues ?? []).filter(
      (issue) =>
        !this.ignored.has(`${issue.rule}:${issue.from}:${issue.original}`),
    );
  }
  private invalidate() {
    this.epoch++;
    clearTimeout(this.timer);
    this.result = null;
    this.text.replaceChildren();
    this.card.hidden = true;
    this.options.status(null);
  }
  private changed() {
    const allowed = this.allowed();
    if (allowed) {
      const text = this.editor.value.slice(0, 6000);
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
    if (allowed && !this.composing && this.options.settings().automatic)
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
    const epoch = this.epoch,
      snapshot = this.editor.value,
      settings = this.options.settings();
    if (!snapshot.trim() || (!settings.spelling && !settings.grammar)) return;
    try {
      const result = await this.options.check(snapshot);
      if (
        epoch !== this.epoch ||
        !this.allowed() ||
        snapshot !== this.editor.value
      )
        return;
      this.snapshot = snapshot;
      this.result = result;
      this.render();
      this.options.status({ ...this.result, issues: this.issues() });
    } catch {
      if (epoch === this.epoch)
        this.options.status(null, "Writing checks could not load. Try again.");
    }
  }
  private render() {
    this.text.replaceChildren();
    if (!this.result || !this.options.settings().highlights || !this.allowed())
      return;
    let at = 0;
    for (const issue of this.issues()) {
      if (issue.from < at) continue;
      this.text.append(
        document.createTextNode(this.snapshot.slice(at, issue.from)),
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
        this.snapshot.slice(at, this.result.checkedTo) + "\n",
      ),
    );
    this.position();
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
    this.text.style.transform = `translate(${-this.editor.scrollLeft}px, ${-this.editor.scrollTop}px)`;
    if (!this.card.hidden) {
      const width = Math.min(340, window.innerWidth - 24);
      const marker = this.anchor
        ? [...this.text.querySelectorAll<HTMLElement>("mark")].find(
            (mark) => mark.dataset.issue === this.anchor!.id,
          )
        : undefined;
      const markerRect = marker?.getBoundingClientRect();
      const anchor =
        markerRect &&
        markerRect.top >= rect.top &&
        markerRect.bottom <= rect.bottom
          ? markerRect
          : rect;
      const left = Math.max(
        12,
        Math.min(anchor.left, window.innerWidth - width - 12),
      );
      const preferred = anchor.bottom + 8;
      const top = Math.max(
        12,
        Math.min(
          preferred,
          window.innerHeight - this.card.getBoundingClientRect().height - 12,
        ),
      );
      this.card.style.left = `${left}px`;
      this.card.style.top = `${top}px`;
    }
  }
  private button(label: string, run: () => void, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", run);
    return button;
  }
  review(issue?: WritingIssue) {
    this.tools?.close(false);
    if (!this.allowed()) return;
    if (!this.result || this.snapshot !== this.editor.value) {
      void this.check().then(() => {
        if (this.result) this.review();
      });
      return;
    }
    this.card.replaceChildren();
    this.anchor = issue;
    const header = document.createElement("header"),
      title = document.createElement("strong");
    title.textContent = issue
      ? issue.rule === "spelling"
        ? "Spelling"
        : "Grammar"
      : "Writing";
    header.append(
      title,
      this.button("Close", () => this.close(), "close"),
    );
    this.card.append(header);
    if (!issue) {
      const issues = this.issues();
      if (!issues.length) {
        const p = document.createElement("p");
        p.textContent = this.result.complete
          ? "No issues found by spelling and basic grammar checks."
          : "No issues found in the checked portion. Text after 6,000 characters is unchecked.";
        this.card.append(p);
      }
      for (const item of issues)
        this.card.append(
          this.button(
            `${item.original} — ${item.rule === "spelling" ? "Spelling" : "Grammar"}`,
            () => this.review(item),
          ),
        );
    } else {
      if (issue.rule === "spelling") {
        const cached = this.suggestions.get(issue.original);
        if (cached) issue.replacements = cached;
      }
      const description = document.createElement("p");
      description.textContent = englishMessages[issue.message];
      const original = document.createElement("p");
      original.className = "original";
      original.textContent = issue.original;
      const actions = document.createElement("div");
      actions.className = "actions";
      const replacements = document.createElement("div");
      replacements.className = "replacements";
      const showReplacements = () => {
        replacements.replaceChildren();
        for (const replacement of issue.replacements)
          replacements.append(
            this.button(
              replacement || "Remove",
              () => this.apply(issue, replacement),
              "replacement",
            ),
          );
        if (!issue.replacements.length)
          replacements.textContent = "No alternative found.";
      };
      showReplacements();
      if (issue.rule === "spelling" && !this.suggestions.has(issue.original)) {
        const epoch = this.epoch;
        const current = () =>
          epoch === this.epoch &&
          this.anchor === issue &&
          !this.card.hidden &&
          this.allowed() &&
          this.snapshot === this.editor.value;
        const load = () => {
          replacements.textContent = "Finding alternatives…";
          void this.options
            .suggest(issue.original)
            .then((values) => {
              if (!current()) return;
              if (this.suggestions.size >= 64)
                this.suggestions.delete(this.suggestions.keys().next().value!);
              this.suggestions.set(issue.original, values);
              issue.replacements = values;
              showReplacements();
              this.schedulePosition();
            })
            .catch(() => {
              if (!current()) return;
              replacements.replaceChildren(
                this.button("Retry alternatives", load),
              );
              this.schedulePosition();
            });
        };
        load();
      }
      actions.append(
        this.button("Ignore", () => {
          this.ignored.set(
            `${issue.rule}:${issue.from}:${issue.original}`,
            issue,
          );
          this.render();
          this.options.status({ ...this.result!, issues: this.issues() });
          this.close();
        }),
      );
      if (issue.rule === "spelling")
        actions.append(
          this.button("Add word", () => {
            void this.options
              .addWord(issue.original)
              .then(() => {
                this.close();
                this.refresh();
              })
              .catch(() => {
                description.textContent = "Word could not be saved. Try again.";
              });
          }),
        );
      this.card.append(description, original, replacements, actions);
    }
    this.card.hidden = false;
    this.position();
    this.card.querySelector("button")?.focus({ preventScroll: true });
  }
  private apply(issue: WritingIssue, replacement: string) {
    if (!this.allowed() || this.snapshot !== this.editor.value) {
      this.close();
      this.refresh();
      return;
    }
    const expected = applyWritingEdit(this.snapshot, issue, replacement);
    if (this.editor.maxLength >= 0 && expected.length > this.editor.maxLength)
      return;
    this.editor.focus({ preventScroll: true });
    this.editor.setSelectionRange(issue.from, issue.to);
    // Native editing transaction preserves undo and framework input behavior.
    document.execCommand("insertText", false, replacement);
    if (this.editor.value !== expected) {
      this.options.status(
        null,
        "This editor cannot apply safely. Copy the correction and edit manually.",
      );
      this.close();
      return;
    }
    this.close();
    this.changed();
  }
  close(focus = true) {
    const wasOpen = !this.card.hidden;
    this.card.hidden = true;
    if (focus && wasOpen && this.editor.isConnected)
      this.editor.focus({ preventScroll: true });
  }
  destroy() {
    this.tools?.destroy();
    this.invalidate();
    this.events.abort();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.resize.disconnect();
    this.host.remove();
  }
}
