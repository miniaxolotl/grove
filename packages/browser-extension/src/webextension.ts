import type { BrowserIdentity, Store } from "./oauth.ts";
import type {
  NativePanelHost,
  CaptureTab,
  ContextMenuCaptureEvent,
} from "./platform.ts";
export type ExtensionConfig = {
  apiOrigin: string;
  siteOrigin: string;
  issuer: string;
  target: "chrome" | "firefox" | "edge";
};
export type StorageArea = {
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
};
type Event<T> = { addListener(listener: T): void };
export type MessageSender = {
  id?: string;
  url?: string;
  frameId?: number;
  documentId?: string;
  tab?: { id?: number; windowId?: number; incognito?: boolean };
};
export type BrowserHost = NativePanelHost & {
  identity: BrowserIdentity;
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: Event<
      (
        message: unknown,
        sender: MessageSender,
        respond: (data: unknown) => void,
      ) => boolean
    >;
    onInstalled: Event<() => void>;
    onStartup: Event<() => void>;
  };
  action: {
    onClicked: Event<(tab: CaptureTab & { windowId?: number }) => void>;
    setBadgeText(options: { text: string }): Promise<void>;
    setBadgeBackgroundColor(options: { color: string }): Promise<void>;
    setTitle(options: { title: string }): Promise<void>;
  };
  contextMenus: {
    create(options: {
      id: string;
      title: string;
      contexts: string[];
      documentUrlPatterns: string[];
    }): void;
    removeAll(): Promise<void>;
    onClicked: Event<
      (
        event: ContextMenuCaptureEvent,
        tab?: CaptureTab & { windowId?: number },
      ) => void
    >;
  };
  windows: {
    getCurrent(): Promise<{ id?: number }>;
    onRemoved: Event<(id: number) => void>;
  };
  tabs: {
    query(options: {
      active?: boolean;
      windowId?: number;
      currentWindow?: boolean;
    }): Promise<(CaptureTab & { id?: number })[]>;
    create(options: { url: string }): Promise<unknown>;
    sendMessage?(tabId: number, message: unknown): Promise<unknown>;
  };
  permissions?: {
    contains(options: { origins: string[] }): Promise<boolean>;
    request(options: { origins: string[] }): Promise<boolean>;
    remove(options: { origins: string[] }): Promise<boolean>;
    onRemoved: Event<() => void>;
  };
  scripting?: {
    registerContentScripts(
      scripts: {
        id: string;
        matches: string[];
        js: string[];
        runAt: "document_idle";
        allFrames: boolean;
        persistAcrossSessions: boolean;
      }[],
    ): Promise<void>;
    unregisterContentScripts(options: { ids: string[] }): Promise<void>;
    getRegisteredContentScripts(): Promise<{ id: string }[]>;
    executeScript(options: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown>;
  };
  storage: {
    session: StorageArea;
    local: StorageArea;
    onChanged: Event<
      (
        changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
        area: string,
      ) => void
    >;
  };
};
export const nativeBrowser =
  (globalThis as unknown as { browser?: BrowserHost; chrome?: BrowserHost })
    .browser ?? (globalThis as unknown as { chrome: BrowserHost }).chrome;
export function storageAdapter(area: StorageArea): Store {
  return {
    async get(key) {
      return (await area.get(key))[key];
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}
export function trustedPanel(
  sender: { id?: string; url?: string },
  runtime: { id: string; getURL(path: string): string },
) {
  return (
    sender.id === runtime.id &&
    typeof sender.url === "string" &&
    sender.url.split(/[?#]/)[0] === runtime.getURL("panel.html")
  );
}
/** Browser-supplied metadata only. Never accept a claimed page origin in a payload. */
export function writingSenderOrigin(
  sender: MessageSender,
  extensionId: string,
): string | null {
  if (
    sender.id !== extensionId ||
    sender.frameId !== 0 ||
    sender.tab?.incognito !== false ||
    !Number.isInteger(sender.tab.id) ||
    !Number.isInteger(sender.tab.windowId) ||
    typeof sender.url !== "string"
  )
    return null;
  try {
    const url = new URL(sender.url);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
export function writingSitePattern(
  origin: string,
  target: ExtensionConfig["target"],
) {
  const url = new URL(origin);
  if (!["https:", "http:"].includes(url.protocol) || url.origin !== origin)
    throw new Error("Choose an ordinary website origin.");
  return `${target === "firefox" ? `${url.protocol}//${url.hostname}` : origin}/*`;
}
declare const __GROVE_EXTENSION_CONFIG__: ExtensionConfig;
export const extensionConfig: ExtensionConfig =
  typeof __GROVE_EXTENSION_CONFIG__ === "undefined"
    ? {
        apiOrigin: "https://api.usegrove.cloud",
        siteOrigin: "https://usegrove.cloud",
        issuer: "https://clerk.usegrove.cloud",
        target: "chrome",
      }
    : __GROVE_EXTENSION_CONFIG__;
