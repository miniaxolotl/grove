import { webCaptureSchema, type WebCapture } from "@lib/shared/web-capture";
import { NOTE_CONTENT_MAX } from "@lib/shared/limits";

export const browserTargets = Object.freeze([
  "chrome",
  "firefox",
  "edge",
] as const);
export type BrowserTarget = (typeof browserTargets)[number];
const profiles = Object.freeze({
  chrome: Object.freeze({
    panelApi: "sidePanel",
    panelManifestKey: "side_panel",
    background: "service_worker",
  } as const),
  firefox: Object.freeze({
    panelApi: "sidebarAction",
    panelManifestKey: "sidebar_action",
    background: "event_page",
  } as const),
  edge: Object.freeze({
    panelApi: "sidePanel",
    panelManifestKey: "side_panel",
    background: "service_worker",
  } as const),
});

/** Descriptors only: these are not installable manifests or browser qualification. */
export function browserProfile(target: BrowserTarget) {
  if (!Object.hasOwn(profiles, target))
    throw new Error("Unsupported browser target");
  return profiles[target];
}

export type NativePanelHost = {
  sidePanel?: { open(options: { windowId: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void> };
};

/** Invoke directly in the original user event; never await I/O before opening. */
export function openNativePanel(
  target: BrowserTarget,
  host: NativePanelHost,
  windowId: number,
): Promise<void> {
  if (!Number.isSafeInteger(windowId) || windowId < 0)
    throw new Error("Invalid browser window");
  if (browserProfile(target).panelApi === "sidebarAction") {
    if (!host.sidebarAction) throw new Error("Native sidebar unavailable");
    return host.sidebarAction.open();
  }
  if (!host.sidePanel) throw new Error("Native side panel unavailable");
  return host.sidePanel.open({ windowId });
}

export type ContextMenuCaptureEvent = {
  menuItemId: string | number;
  selectionText?: string;
  linkUrl?: string;
  linkText?: string;
  frameUrl?: string;
  pageUrl?: string;
};
export type CaptureTab = {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  title?: string;
  incognito?: boolean;
};

/** Only active-tab metadata; never traverse the document or retain browsing history. */
export function tabSource(
  tab: CaptureTab | undefined,
  now: number,
): WebCapture | null {
  if (!tab?.url || tab.incognito !== false) return null;
  const parsed = webCaptureSchema.safeParse({
    url: tab.url,
    title: [...(tab.title ?? "")]
      .map((character) => {
        const code = character.codePointAt(0)!;
        return code < 32 || code === 127 ? " " : character;
      })
      .join("")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 300),
    capturedAt: new Date(now).toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

/** Pure event snapshot: no page traversal, storage, browser messages or requests. */
export function contextMenuCapture(
  event: ContextMenuCaptureEvent,
  tab: CaptureTab,
  now: number,
): {
  text: string;
  source: WebCapture;
} | null {
  if (
    event.menuItemId !== "grove-capture-selection" &&
    event.menuItemId !== "grove-capture-link"
  )
    return null;
  if (tab.incognito !== false)
    throw new Error("Private-browsing capture is not supported");
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error("Invalid capture timestamp");
  const link = event.menuItemId === "grove-capture-link";
  let text = "";
  if (!link) {
    if (
      typeof event.selectionText !== "string" ||
      !event.selectionText.trim() ||
      event.selectionText.length > NOTE_CONTENT_MAX
    )
      throw new Error(
        `Selection must contain 1–${NOTE_CONTENT_MAX.toLocaleString()} characters`,
      );
    text = event.selectionText;
  }
  const url = link
    ? event.linkUrl
    : (event.frameUrl ?? event.pageUrl ?? tab.url);
  const title = link
    ? (event.linkText ?? "")
    : tab.url === url
      ? (tab.title ?? "")
      : "";
  const source = webCaptureSchema.parse({
    url,
    title,
    capturedAt: new Date(now).toISOString(),
  });
  return { text, source };
}
