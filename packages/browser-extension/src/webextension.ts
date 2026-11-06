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
export type BrowserHost = NativePanelHost & {
  identity: BrowserIdentity;
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: Event<
      (
        message: unknown,
        sender: { id?: string; url?: string },
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
      active: boolean;
      windowId: number;
    }): Promise<CaptureTab[]>;
    create(options: { url: string }): Promise<unknown>;
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
