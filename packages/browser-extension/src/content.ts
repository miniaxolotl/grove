import { nativeBrowser as host } from "./webextension.ts";
import {
  writingSettingsSchema,
  type WritingResult,
  type WritingSettings,
} from "./writing/core.ts";
import { isWritingEditor, writingEditorFrom } from "./writing/editor.ts";
import { WritingController } from "./writing/controller.ts";
import { reviewActionSchema } from "./writing/review.ts";
import {
  unavailableWriting,
  type WritingAvailability,
} from "@lib/shared/writing-assistance";
import { PROOFING_CONTENT_MAX } from "@lib/shared/limits";

const environment = globalThis as typeof globalThis & {
  groveWritingInstalled?: boolean;
};
if (!environment.groveWritingInstalled) {
  environment.groveWritingInstalled = true;
  let settings = writingSettingsSchema.parse({ enabled: false });
  let controller: WritingController | undefined,
    active: HTMLElement | undefined;
  let epoch = 0,
    tools = unavailableWriting,
    binding: string | null = null;
  let notification = false;
  const nativeMarker = "data-grove-native-writing";
  const pauses = new WeakSet<HTMLElement>();
  const rootChanges = new MutationObserver(() => {
    if (active && (!settings.enabled || !isWritingEditor(active))) detach();
  });
  async function rpc<T>(kind: string, payload?: unknown): Promise<T> {
    const result = (await host.runtime.sendMessage({
      kind,
      ...(payload ? { payload } : {}),
      ...(kind.startsWith("writingAI") && binding ? { binding } : {}),
    })) as { ok: boolean; data: T };
    if (!result?.ok)
      throw new Error("Writing checks aren’t available. Try again.");
    return result.data;
  }
  function notify() {
    if (notification) return;
    notification = true;
    queueMicrotask(() => {
      notification = false;
      void rpc("writingReviewChanged").catch(() => {});
    });
  }
  function detach() {
    rootChanges.disconnect();
    if (!controller && !active) return;
    controller?.destroy();
    controller = undefined;
    active = undefined;
    notify();
  }
  function bind(target: EventTarget | null) {
    if (document.documentElement.hasAttribute(nativeMarker)) {
      detach();
      return;
    }
    const element = writingEditorFrom(target);
    if (!element || !settings.enabled || !isWritingEditor(element)) {
      detach();
      return;
    }
    if (element === active) return;
    detach();
    active = element;
    const root = element.getRootNode();
    if (root instanceof ShadowRoot) rootChanges.observe(root, observation);
    controller = new WritingController(element, {
      settings: () => settings,
      indicator: true,
      check: async (text) => {
        const result = await rpc<WritingResult>("writingSiteCheck", {
          text: text.slice(0, PROOFING_CONTENT_MAX),
        });
        return {
          ...result,
          complete: result.complete && text.length <= PROOFING_CONTENT_MAX,
        };
      },
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
      status: () => {},
      changed: () => {
        if (controller?.state()?.phase === "paused") pauses.add(element);
        else if (controller?.state()) pauses.delete(element);
        notify();
      },
      settingsAction: () => {
        void rpc("writingReviewOpen", { view: "settings" }).catch(() => {});
      },
      sidebarAction: () => {
        void rpc("writingReviewOpen", { view: "writing" }).catch(() => {});
      },
    });
    if (pauses.has(element)) {
      const state = controller.state();
      if (state)
        void controller.action({
          editorId: state.editorId,
          revision: state.revision,
          action: "pause",
        });
    } else controller.refresh();
  }
  function focused(): Element | null {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement)
      element = element.shadowRoot.activeElement;
    return element;
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
      else if (active && !isWritingEditor(active)) detach();
      else if (active) controller?.refresh();
      else bind(focused());
    } catch {
      if (current === epoch) {
        settings = writingSettingsSchema.parse({ enabled: false });
        detach();
      }
    }
  }
  document.addEventListener("focusin", (event) => {
    const path = event.composedPath();
    if (
      path.some(
        (node) =>
          node instanceof HTMLElement && node.dataset.groveWritingUi === "true",
      )
    )
      return;
    bind(path[0] ?? event.target);
  });
  for (const name of ["pointerdown", "keydown"] as const)
    document.addEventListener(
      name,
      (event) => {
        if (!active && settings.enabled && event.isTrusted)
          bind(event.composedPath()[0] ?? event.target);
      },
      { capture: true },
    );
  const changes = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target === document.documentElement &&
          record.attributeName === nativeMarker,
      )
    ) {
      bind(focused());
      return;
    }
    if (active && (!settings.enabled || !isWritingEditor(active))) detach();
    if (
      !active &&
      settings.enabled &&
      focused() instanceof HTMLElement &&
      isWritingEditor(focused() as HTMLElement)
    )
      bind(focused());
  });
  const observation: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      nativeMarker,
      "type",
      "inputmode",
      "contenteditable",
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
  };
  changes.observe(document.documentElement, observation);
  host.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== host.runtime.id || sender.tab) return false;
    const kind = (message as { kind?: string })?.kind;
    if (kind === "writingReviewGet") {
      respond(controller?.state() ?? null);
      return false;
    }
    if (kind === "writingReviewAction") {
      const parsed = reviewActionSchema.safeParse(
        (message as { payload?: unknown }).payload,
      );
      if (!parsed.success || !controller) {
        respond(null);
        return false;
      }
      const owner = controller;
      void owner.action(parsed.data, true).then(
        () => respond(owner === controller ? owner.state() : null),
        () => respond(null),
      );
      return true;
    }
    if (kind === "writingToolsState") {
      tools = (message as { tools: WritingAvailability }).tools;
      controller?.refreshTools();
    }
    if (kind === "writingRefresh") void refresh();
    return false;
  });
  window.addEventListener("pagehide", () => {
    epoch++;
    detach();
    changes.disconnect();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      changes.observe(document.documentElement, observation);
      void refresh();
    }
  });
  void refresh();
}
