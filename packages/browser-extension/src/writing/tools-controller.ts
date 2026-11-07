import {
  selectWritingSentence,
  writingTools,
  isWritingWord,
  writingContextFor,
  hasCurrentWritingConsent,
  unavailableWriting,
  type WritingAvailability,
  type WritingSelection,
  type WritingTool,
  type WritingRequest,
  type WritingWork,
} from "@lib/shared/writing-assistance";
import { isWritingEditor } from "./editor.ts";
import type { WritingSettings } from "./core.ts";
import { copyText, copyWritingChoice } from "./clipboard.ts";
import { GroveError } from "@lib/shared/contracts";
import { NOTE_CONTENT_MAX } from "@lib/shared/limits";

export type WritingToolTransport = {
  availability: () => WritingAvailability;
  consent: (accepted: boolean) => Promise<WritingAvailability>;
  request: (input: WritingRequest) => Promise<WritingWork>;
  get: (id: string) => Promise<WritingWork>;
  cancel: (id: string) => Promise<unknown>;
};
const css = `
:host{all:initial;font:14px/1.5 system-ui,sans-serif;color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}
button{font:inherit;color:inherit;cursor:pointer;min-height:40px;border-radius:12px;border:0;padding:9px 12px;background:transparent}button:hover{background:light-dark(#edf3eb,#303b31)}
button:focus-visible,a:focus-visible{outline:2px solid currentColor;outline-offset:2px}button:disabled{cursor:default;opacity:.65}
.trigger{position:fixed;z-index:2147483647;padding:4px 12px;min-height:32px;border-radius:20px;background:light-dark(#e6eee3,#303b31);color:light-dark(#243f2e,#d8e7db)}
.card{position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:12px;border:1px solid light-dark(#d6dfd3,#465446);border-radius:20px;background:light-dark(#fff,#222922);color:light-dark(#181d19,#edf1ed);box-shadow:0 12px 32px #0002}
header,.actions{display:flex;align-items:center;justify-content:space-between;gap:8px}header{margin-bottom:8px}.close{border:0}strong{font-weight:600}
.menu{display:grid;gap:2px}.tool{text-align:start;padding:10px 12px}.description{display:none}.tool[title]{cursor:pointer}
p{margin:8px 0 12px}.original{max-height:80px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:light-dark(#f0f5ed,#303b31);padding:12px;border-radius:12px}.status{min-height:20px;margin:8px 0;font-size:12px;color:light-dark(#59635b,#b8c4ba)}.alternatives{display:grid;gap:2px}.alternative{text-align:start;white-space:pre-wrap;overflow-wrap:anywhere;width:100%;font-size:15px}.actions{justify-content:flex-start;margin-top:8px}.copy{min-height:32px;padding:4px 8px;font-size:12px;color:light-dark(#59635b,#b8c4ba)}.footnote{font-size:12px;color:light-dark(#59635b,#b8c4ba)}
.geometry{position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word}.alternative-row{display:flex;align-items:flex-start;gap:6px}.alternative-row .alternative{flex:1;min-width:0}.alternative-row .copy{flex:none;min-height:40px}
.footnote{overflow-wrap:anywhere}
.status:empty{display:none}
`;

/** Selection UI only; all AI execution belongs to authenticated durable server work. */
export class WritingToolsController {
  private host = document.createElement("span");
  private shadow = this.host.attachShadow({ mode: "open" });
  private trigger = document.createElement("button");
  private card = document.createElement("section");
  private geometry = document.createElement("div");
  private marker = document.createElement("span");
  private measured = "";
  private events = new AbortController();
  private selection: WritingSelection | null = null;
  private snapshot = "";
  private epoch = 0;
  private frame: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private work: WritingWork | undefined;
  private pendingId: string | undefined;
  private pollingEpoch: number | undefined;
  private composing = false;
  private sessionId = crypto.randomUUID();
  private availability: WritingAvailability | undefined;
  constructor(
    private editor: HTMLTextAreaElement,
    private settings: () => WritingSettings,
    private transport: WritingToolTransport,
    private closeOther: () => void,
    private feedback?: (message: string) => void,
  ) {
    this.host.dataset.groveWritingUi = "true";
    this.host.dataset.groveWritingTools = "true";
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    this.shadow.adoptedStyleSheets = [sheet];
    this.trigger.type = "button";
    this.trigger.className = "trigger";
    this.trigger.textContent = "Use AI";
    this.trigger.hidden = true;
    this.trigger.setAttribute("aria-haspopup", "dialog");
    this.trigger.addEventListener("click", (event) => {
      if (event.isTrusted) this.menu();
    });
    this.card.className = "card";
    this.card.hidden = true;
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "AI writing tools");
    this.geometry.className = "geometry";
    this.geometry.setAttribute("aria-hidden", "true");
    this.shadow.append(this.geometry, this.trigger, this.card);
    document.body.append(this.host);
    const event = { signal: this.events.signal };
    for (const name of ["select", "pointerup", "keyup", "focus"] as const)
      editor.addEventListener(name, () => this.schedule(), event);
    editor.addEventListener("input", () => this.invalidate(), event);
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
        this.schedule();
      },
      event,
    );
    editor.addEventListener(
      "keydown",
      (event) => {
        if (
          event.isTrusted &&
          event.altKey &&
          event.key === "Enter" &&
          editor.selectionStart !== editor.selectionEnd &&
          this.allowed()
        ) {
          event.preventDefault();
          this.update();
          if (this.selection) this.menu();
        }
        if (event.key === "Escape") this.close();
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
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          const buttons = [
            ...this.card.querySelectorAll<HTMLButtonElement>(
              "[role='menuitem']:not(:disabled)",
            ),
          ];
          if (!buttons.length) return;
          event.preventDefault();
          const at = buttons.indexOf(
            this.shadow.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[index].focus({ preventScroll: true });
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
    document.addEventListener("scroll", () => this.schedule(), {
      ...event,
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", () => this.schedule(), event);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) clearTimeout(this.timer);
        else if (this.work) void this.poll(this.epoch);
      },
      event,
    );
  }
  private allowed() {
    const settings = this.settings();
    const availability = this.transport.availability();
    return (
      !this.events.signal.aborted &&
      !this.composing &&
      settings.enabled &&
      settings.aiRewrites &&
      availability.available &&
      availability.authorized &&
      isWritingEditor(this.editor)
    );
  }
  private current(epoch = this.epoch) {
    return (
      epoch === this.epoch &&
      this.allowed() &&
      !!this.selection &&
      this.editor.value === this.snapshot
    );
  }
  private button(label: string, run: () => void, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", (event) => {
      if (event.isTrusted) run();
    });
    return button;
  }
  private schedule() {
    if (this.frame !== undefined || this.events.signal.aborted) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.update();
    });
  }
  private update() {
    if (!this.allowed()) {
      this.invalidate();
      return;
    }
    if (document.activeElement === this.editor && this.card.hidden) {
      const from = this.editor.selectionStart,
        to = this.editor.selectionEnd;
      if (from === to || to - from > 2000) {
        this.trigger.hidden = true;
        return;
      }
      const snapshot = this.editor.value;
      this.selection = selectWritingSentence(snapshot, from, to);
      this.snapshot = snapshot;
      this.trigger.hidden = !this.selection;
    }
    this.position();
  }
  private position() {
    const rect = this.editor.getBoundingClientRect();
    let anchor: DOMRect = rect;
    // Layout only the bounded prefix needed to locate the selected sentence. Never
    // mirror a whole long-form editor merely to position its contextual menu.
    if (this.selection && this.selection.to <= NOTE_CONTENT_MAX) {
      const computed = getComputedStyle(this.editor);
      Object.assign(this.geometry.style, {
        left: `${rect.left + this.editor.clientLeft - this.editor.scrollLeft}px`,
        top: `${rect.top + this.editor.clientTop - this.editor.scrollTop}px`,
        width: `${this.editor.clientWidth}px`,
      });
      for (const key of [
        "font",
        "lineHeight",
        "letterSpacing",
        "wordSpacing",
        "textIndent",
        "textAlign",
        "direction",
        "tabSize",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
      ] as const)
        this.geometry.style[key] = computed[key];
      const measured = `${this.selection.from}:${this.selection.to}:${this.snapshot.slice(0, this.selection.to)}`;
      if (this.measured !== measured) {
        this.measured = measured;
        this.marker.textContent = this.selection.original;
        this.geometry.replaceChildren(
          document.createTextNode(this.snapshot.slice(0, this.selection.from)),
          this.marker,
        );
      }
      const selected = this.marker.getBoundingClientRect();
      if (selected.top >= rect.top && selected.bottom <= rect.bottom)
        anchor = selected;
    }
    const scheme = getComputedStyle(this.editor).colorScheme;
    if (scheme !== "normal") this.host.style.colorScheme = scheme;
    this.trigger.style.left = `${Math.max(12, Math.min(anchor.right - 80, innerWidth - 92))}px`;
    this.trigger.style.top = `${Math.max(12, anchor.top - 38)}px`;
    if (!this.card.hidden) {
      this.card.style.maxHeight = `${Math.max(80, Math.max(anchor.top - 20, innerHeight - anchor.bottom - 20))}px`;
      const width = Math.min(340, innerWidth - 24),
        height = this.card.getBoundingClientRect().height;
      this.card.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - width - 12))}px`;
      const above = anchor.top - height - 8;
      this.card.style.top = `${Math.max(12, Math.min(above >= 12 ? above : anchor.bottom + 8, innerHeight - height - 12))}px`;
    }
  }
  private header(title: string) {
    const header = document.createElement("header"),
      heading = document.createElement("strong");
    header.setAttribute("role", "presentation");
    heading.textContent = title;
    header.append(
      heading,
      this.button("Close", () => this.close(), "close"),
    );
    this.card.append(header);
  }
  menu() {
    if (!this.current()) return;
    this.closeOther();
    this.trigger.hidden = true;
    this.card.replaceChildren();
    this.header(
      isWritingWord(this.selection!.original) ? "Word choices" : "Rewrite",
    );
    const availability =
      this.availability ?? this.transport.availability() ?? unavailableWriting;
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Writing tools");
    const word = isWritingWord(this.selection!.original);
    const visibleTools = writingTools.filter((tool) =>
      word
        ? ["synonyms", "antonyms", "rewrite", "humanize"].includes(tool.id)
        : !["synonyms", "antonyms"].includes(tool.id),
    );
    if (word)
      visibleTools.sort(
        (a, b) =>
          ["synonyms", "antonyms", "rewrite", "humanize"].indexOf(a.id) -
          ["synonyms", "antonyms", "rewrite", "humanize"].indexOf(b.id),
      );
    for (const tool of visibleTools) {
      const button = this.button(
        tool.label,
        () => this.choose(tool.id),
        "tool",
      );
      button.setAttribute("aria-label", tool.label);
      button.title = tool.description;
      button.setAttribute("role", "menuitem");
      button.disabled = !availability.available || !availability.authorized;
      const description = document.createElement("span");
      description.className = "description";
      description.textContent = tool.description;
      button.append(description);
      menu.append(button);
    }
    this.card.append(menu);
    const allowance = document.createElement("p");
    allowance.className = "footnote";
    allowance.textContent =
      "Rewrites use your monthly allowance: 100 on Free, 1,000 on Pro. Local spelling and grammar checks are unlimited.";
    this.card.append(allowance);
    if (!availability.available || !availability.authorized) {
      const reason = document.createElement("p");
      reason.className = "footnote";
      reason.textContent = !availability.available
        ? "AI tools aren’t available right now."
        : "Allow AI writing tools in Grove to use these options.";
      this.card.append(reason);
    }
    this.card.hidden = false;
    this.position();
    (
      menu.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
      this.card.querySelector("button")
    )?.focus({ preventScroll: true });
  }
  private original() {
    const original = document.createElement("p");
    original.className = "original";
    original.textContent = this.selection!.original;
    this.card.append(original);
  }
  private choose(tool: WritingTool) {
    if (!this.current()) return;
    const availability = this.availability ?? this.transport.availability();
    this.card.replaceChildren();
    this.header(writingTools.find((item) => item.id === tool)!.label);
    if (!hasCurrentWritingConsent(availability)) {
      this.original();
      const notice = document.createElement("p");
      notice.textContent =
        "AI uses your selection and nearby text to suggest alternatives.";
      this.card.append(notice);
      if (availability.provider) {
        const privacy = document.createElement("details"),
          summary = document.createElement("summary"),
          text = document.createElement("p");
        privacy.className = "footnote";
        summary.textContent = "Privacy";
        text.textContent = availability.provider;
        privacy.append(summary, text);
        this.card.append(privacy);
      }
      this.card.append(
        this.button("Generate alternatives", () => {
          void this.generate(tool, true);
        }),
      );
      this.position();
      (this.card.lastElementChild as HTMLButtonElement | null)?.focus({
        preventScroll: true,
      });
      return;
    }
    void this.generate(tool, false);
  }
  private context(tool: WritingTool) {
    return ["synonyms", "antonyms"].includes(tool)
      ? null
      : writingContextFor(this.snapshot, this.selection);
  }
  private async generate(tool: WritingTool, consent: boolean) {
    const epoch = ++this.epoch;
    if (!this.current(epoch)) return;
    const status = document.createElement("p");
    status.className = "status";
    status.setAttribute("role", "status");
    status.textContent = "Finding alternatives…";
    this.card.replaceChildren();
    this.header(writingTools.find((item) => item.id === tool)!.label);
    this.card.append(status);
    const results = document.createElement("div");
    results.className = "work-results";
    const actions = document.createElement("div");
    actions.className = "actions";
    const dismiss = this.button("Cancel", () => this.close());
    dismiss.dataset.dismiss = "true";
    actions.append(
      this.button("Back", () => {
        this.stopWork();
        this.menu();
      }),
      dismiss,
    );
    this.card.append(results, actions);
    this.position();
    this.card
      .querySelector<HTMLButtonElement>("header button")
      ?.focus({ preventScroll: true });
    try {
      if (consent) this.availability = await this.transport.consent(true);
      if (!this.current(epoch)) return;
      const context = this.context(tool);
      const input: WritingRequest = {
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        tool,
        language: "en",
        sentence: this.selection!.original,
        ...(context ? { context } : {}),
      };
      this.pendingId = input.id;
      const work = await this.transport.request(input);
      if (!this.current(epoch)) {
        void this.transport.cancel(input.id).catch(() => {});
        return;
      }
      this.work = work;
      this.renderWork();
      if (
        ["queued", "processing", "backoff", "recovering"].includes(work.status)
      )
        this.timer = setTimeout(() => {
          void this.poll(epoch);
        }, 800);
    } catch (error) {
      if (!this.current(epoch)) return;
      const quotaReset =
        error instanceof GroveError &&
        error.code === "usage_limit" &&
        error.details?.resource === "writing"
          ? (error.details.resetAt ?? null)
          : undefined;
      if (quotaReset !== undefined) {
        status.textContent = `Monthly rewrite allowance used${quotaReset ? ` — resets ${new Date(quotaReset).toLocaleDateString(undefined, { month: "long", day: "numeric" })}` : ""}. Local spelling and grammar checks keep working.`;
      } else {
        status.textContent = this.pendingId
          ? "Not confirmed. Check status before trying again."
          : "Couldn’t start. Your text is unchanged.";
        if (this.pendingId)
          this.card.append(
            this.button("Check status", () => {
              void this.poll(epoch);
            }),
          );
      }
      this.position();
    }
  }
  private renderWork() {
    if (!this.work || !this.current()) return;
    if (Date.parse(this.work.expiresAt) <= Date.now())
      this.work = { ...this.work, status: "expired", result: null };
    const work = this.work;
    const status = this.card.querySelector<HTMLElement>(".status");
    const results = this.card.querySelector<HTMLElement>(".work-results");
    if (!status || !results) return;
    if (work.status === "expired") results.replaceChildren();
    status.textContent = {
      queued: "Queued",
      processing: "Generating alternatives…",
      backoff: "Waiting to retry",
      recovering: "Reconnecting…",
      uncertain: "Not confirmed. Check status before trying again.",
      completed: "",
      failed: "Couldn’t find alternatives. Try again.",
      cancelled: "Cancelled. Your text is unchanged.",
      expired: "These alternatives expired. Your text is unchanged.",
    }[work.status];
    const dismiss =
      this.card.querySelector<HTMLButtonElement>("[data-dismiss]");
    if (dismiss)
      dismiss.hidden = ![
        "queued",
        "processing",
        "backoff",
        "recovering",
      ].includes(work.status);
    if (dismiss)
      dismiss.textContent = [
        "queued",
        "processing",
        "backoff",
        "recovering",
      ].includes(work.status)
        ? "Cancel"
        : "Dismiss";
    if (
      work.status === "completed" &&
      work.result &&
      work.result.original === this.selection!.original &&
      work.result.tool === work.tool &&
      results.dataset.workId !== work.id
    ) {
      const alternatives = document.createElement("div");
      alternatives.className = "alternatives";
      for (const text of work.result.alternatives) {
        const row = document.createElement("div");
        row.className = "alternative-row";
        row.append(this.button(text, () => this.apply(text), "alternative"));
        row.append(
          this.button(
            "Copy",
            () => {
              if (!this.current() || !this.freshWork()) return;
              void copyText(text).then((ok) => {
                status.textContent = ok
                  ? "Copied"
                  : "Clipboard unavailable. Select and copy the alternative manually.";
              });
            },
            "copy",
          ),
        );
        alternatives.append(row);
      }
      results.replaceChildren(alternatives);
      results.dataset.workId = work.id;
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => this.renderWork(),
        Math.max(0, Date.parse(work.expiresAt) - Date.now()),
      );
    }
    this.position();
  }
  private async poll(epoch: number) {
    if (
      !this.pendingId ||
      !this.current(epoch) ||
      document.hidden ||
      this.pollingEpoch === epoch ||
      (this.work &&
        !["queued", "processing", "backoff", "recovering"].includes(
          this.work.status,
        ))
    )
      return;
    this.pollingEpoch = epoch;
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      const work = await this.transport.get(this.pendingId);
      if (!this.current(epoch)) return;
      this.work = work;
      this.renderWork();
      if (
        ["queued", "processing", "backoff", "recovering"].includes(work.status)
      )
        this.timer = setTimeout(() => {
          void this.poll(epoch);
        }, 1500);
    } catch {
      if (!this.current(epoch)) return;
      const status = this.card.querySelector<HTMLElement>(".status");
      if (status)
        status.textContent =
          "Status could not refresh. Your text is unchanged.";
      this.card.append(
        this.button("Retry status", () => {
          void this.poll(epoch);
        }),
      );
    } finally {
      if (this.pollingEpoch === epoch) this.pollingEpoch = undefined;
    }
  }
  private apply(text: string) {
    if (!this.current() || !this.selection) {
      this.invalidate();
      return;
    }
    if (!this.freshWork()) return;
    const { from, to } = this.selection,
      expected = this.snapshot.slice(0, from) + text + this.snapshot.slice(to);
    if (this.editor.maxLength >= 0 && expected.length > this.editor.maxLength)
      return;
    this.editor.focus({ preventScroll: true });
    this.editor.setSelectionRange(from, to);
    document.execCommand("insertText", false, text);
    if (this.editor.value !== expected) {
      this.invalidate();
      return;
    }
    copyWritingChoice(text, this.feedback);
    this.invalidate();
  }
  private freshWork() {
    if (
      this.work?.status === "completed" &&
      Date.parse(this.work.expiresAt) > Date.now()
    )
      return true;
    this.renderWork();
    return false;
  }
  private stopWork() {
    this.epoch++;
    clearTimeout(this.timer);
    if (this.pendingId) {
      const id = this.pendingId;
      this.pendingId = undefined;
      void this.transport.cancel(id).catch(() => {});
    }
    this.work = undefined;
  }
  close(focus = true) {
    const open = !this.card.hidden;
    this.card.hidden = true;
    this.stopWork();
    if (focus && open && this.allowed() && this.selection) {
      this.editor.focus({ preventScroll: true });
      this.editor.setSelectionRange(this.selection.from, this.selection.to);
    }
  }
  private invalidate() {
    this.close(false);
    this.trigger.hidden = true;
    this.selection = null;
    this.snapshot = "";
    this.geometry.replaceChildren();
    this.measured = "";
  }
  refresh() {
    this.availability = undefined;
    const availability = this.transport.availability();
    if (
      !this.allowed() ||
      !availability.available ||
      !availability.authorized ||
      (this.pendingId && !availability.consented)
    )
      this.invalidate();
    else this.schedule();
  }
  destroy() {
    this.invalidate();
    this.events.abort();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.host.remove();
  }
}
