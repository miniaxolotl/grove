import { nativeBrowser as host } from "./webextension.ts";
import {
  writingSettingsSchema,
  type WritingResult,
  type WritingSettings,
} from "./writing/core.ts";
import { isWritingEditor } from "./writing/editor.ts";
import { WritingController } from "./writing/controller.ts";
import {
  unavailableWriting,
  type WritingAvailability,
} from "@lib/shared/writing-assistance";
import { NOTE_CONTENT_MAX } from "@lib/shared/limits";

// Isolated-world flag prevents duplicate controllers after explicit re-injection.
const environment = globalThis as typeof globalThis & {
  groveWritingInstalled?: boolean;
};
if (!environment.groveWritingInstalled) {
  environment.groveWritingInstalled = true;
  let settings = writingSettingsSchema.parse({ enabled: false });
  let controller: WritingController | undefined,
    active: HTMLTextAreaElement | undefined;
  let epoch = 0;
  let tools = unavailableWriting,
    binding: string | null = null;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.hidden = true;
  badge.dataset.groveWritingUi = "true";
  Object.assign(badge.style, {
    position: "fixed",
    zIndex: "2147483646",
    minHeight: "32px",
    padding: "4px 8px",
    font: "13px/20px system-ui,sans-serif",
    background: "Canvas",
    color: "CanvasText",
    border: "1px solid GrayText",
    borderRadius: "6px",
    cursor: "pointer",
  });
  badge.addEventListener("click", (event) => {
    if (event.isTrusted) controller?.review();
  });
  document.documentElement.append(badge);
  async function rpc<T>(kind: string, payload?: unknown): Promise<T> {
    const result = (await host.runtime.sendMessage({
      kind,
      ...(payload ? { payload } : {}),
      ...(kind.startsWith("writingAI") && binding ? { binding } : {}),
    })) as { ok: boolean; data: T; error?: { message?: string } };
    if (!result?.ok)
      throw new Error("Writing checks aren’t available. Try again.");
    return result.data;
  }
  function detach() {
    controller?.destroy();
    controller = undefined;
    active = undefined;
    badge.hidden = true;
  }
  function status(result: WritingResult | null, error?: string) {
    badge.hidden = true;
    if (
      !active ||
      !settings.enabled ||
      !isWritingEditor(active) ||
      (!result?.issues.length && !error)
    )
      return;
    const rect = active.getBoundingClientRect(),
      top = rect.bottom + 4;
    // Never place a writing affordance over the editor or an existing host control.
    if (top + 32 > innerHeight || rect.left < 0) return;
    const beneath = document.elementFromPoint(rect.left + 4, top + 16);
    if (
      beneath &&
      beneath !== document.body &&
      beneath !== document.documentElement &&
      beneath !== active.parentElement
    )
      return;
    badge.textContent = error
      ? "Retry writing checks"
      : `${result!.issues.length} suggestion${result!.issues.length === 1 ? "" : "s"}`;
    badge.title = error ?? "Spelling and basic grammar · Alt+Enter";
    badge.style.left = `${Math.max(4, rect.left)}px`;
    badge.style.top = `${top}px`;
    badge.hidden = false;
  }
  function bind(element: EventTarget | null) {
    // First-party Grove pages with native proofing own their editor: never
    // inject a second writer there. The webapp sets this marker while its
    // own proofing is mounted and enabled.
    if (
      document.documentElement.hasAttribute("data-grove-native-writing")
    ) {
      if (element !== badge) detach();
      return;
    }
    // Check metadata BEFORE reading .value. All inputs and unqualified rich editors
    // remain unbound; the first supported website adapter is multiline textarea.
    if (
      !(element instanceof HTMLTextAreaElement) ||
      !settings.enabled ||
      !isWritingEditor(element)
    ) {
      if (element !== badge) detach();
      return;
    }
    if (element === active) return;
    detach();
    active = element;
    controller = new WritingController(element, {
      settings: () => settings,
      check: async (text) => {
        const result = await rpc<WritingResult>("writingSiteCheck", {
          text: text.slice(0, NOTE_CONTENT_MAX),
        });
        return {
          ...result,
          complete: result.complete && text.length <= NOTE_CONTENT_MAX,
        };
      },
      suggest: (word) => rpc("writingSiteSuggest", { word }),
      tools: {
        availability: () => (binding ? tools : unavailableWriting),
        consent: async (accepted) => {
          tools = await rpc<WritingAvailability>("writingAIConsent", {
            policy: tools.policy,
            accepted,
          });
          return tools;
        },
        request: (input) => rpc("writingAIRequest", input),
        get: (id) => rpc("writingAIGet", id),
        cancel: (id) => rpc("writingAICancel", id),
      },
      addWord: async (word) => {
        await rpc("writingSiteAddWord", { word });
        await refresh();
      },
      status,
      feedback: (message) => {
        badge.textContent = message;
        badge.setAttribute("aria-live", "polite");
        badge.hidden = false;
      },
    });
    controller.refresh();
  }
  async function refresh() {
    const current = ++epoch;
    try {
      const next = await rpc<{
        settings: WritingSettings;
        tools?: WritingAvailability;
        binding?: string | null;
      }>("writingSiteState");
      if (current !== epoch) return;
      settings = writingSettingsSchema.parse(next.settings);
      tools = next.tools ?? unavailableWriting;
      binding = next.binding ?? null;
      if (!settings.enabled) detach();
      else if (active) controller?.refresh();
      else bind(document.activeElement);
    } catch {
      if (current === epoch) {
        settings = writingSettingsSchema.parse({ enabled: false });
        detach();
      }
    }
  }
  document.addEventListener("focusin", (event) => {
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            node.dataset.groveWritingUi === "true",
        )
    )
      return;
    bind(event.target);
  });
  const changes = new MutationObserver(() => {
    if (active && (!settings.enabled || !isWritingEditor(active))) detach();
  });
  const observation: MutationObserverInit = {
    subtree: true,
    attributes: true,
    attributeFilter: [
      "type",
      "autocomplete",
      "readonly",
      "disabled",
      "hidden",
      "inert",
      "aria-hidden",
      "aria-label",
      "aria-labelledby",
      "aria-disabled",
      "aria-readonly",
      "aria-multiline",
      "spellcheck",
      "rows",
      "role",
      "name",
      "id",
      "class",
      "style",
    ],
    childList: true,
    characterData: true,
  };
  changes.observe(document.documentElement, observation);
  host.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id === host.runtime.id &&
      !sender.tab &&
      (message as { kind?: string })?.kind === "writingToolsState"
    ) {
      tools = (message as { tools: WritingAvailability }).tools;
      controller?.refreshTools();
      return false;
    }
    if (
      sender.id === host.runtime.id &&
      !sender.tab &&
      (message as { kind?: string })?.kind === "writingRefresh"
    )
      void refresh();
    return false;
  });
  window.addEventListener("pagehide", () => {
    epoch++;
    detach();
    changes.disconnect();
    badge.remove();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    document.documentElement.append(badge);
    changes.observe(document.documentElement, observation);
    void refresh();
  });
  void refresh();
}
