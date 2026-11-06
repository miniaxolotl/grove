import { z } from "zod";
import { GroveError } from "@lib/shared/contracts";
import { webCaptureSchema } from "@lib/shared/web-capture";
import { BrowserOAuth } from "./oauth.ts";
import { ExtensionClient } from "./client.ts";
import {
  nativeBrowser as host,
  extensionConfig as config,
  storageAdapter,
  trustedPanel,
  writingSenderOrigin,
  writingSitePattern,
  type MessageSender,
} from "./webextension.ts";
import { contextMenuCapture, openNativePanel } from "./platform.ts";
import { WritingPreferencesStore } from "./writing/preferences.ts";
import {
  effectiveWritingSettings,
  writingSettingsSchema,
} from "./writing/core.ts";

const local = storageAdapter(host.storage.local),
  session = storageAdapter(host.storage.session);
const oauth = new BrowserOAuth(config, local, session, host.identity);
const client = new ExtensionClient(config, local, session, oauth);
const writing = new WritingPreferencesStore(local, config.apiOrigin);
let english:
  | Promise<(typeof import("./writing/english.ts"))["englishChecker"]>
  | undefined;
const localChecker = () =>
  (english ??= import("./writing/english.ts")
    .then((module) => module.englishChecker)
    .catch((error) => {
      english = undefined;
      throw error;
    }));
const ready =
  host.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }) ??
  Promise.resolve();
const preferenceSchema = z
  .object({
    enabled: z.boolean().default(true),
    theme: z.enum(["system", "light", "dark"]).default("system"),
  })
  .strict();
let enabled = false;
async function preferences() {
  return preferenceSchema.parse((await local.get("preferences")) ?? {});
}
const request = z
  .object({
    kind: z.enum([
      "preferences",
      "configure",
      "state",
      "login",
      "logout",
      "edit",
      "save",
      "clear",
      "notebooks",
      "search",
      "pages",
      "read",
      "context",
      "reconcile",
      "attach",
      "inbox",
      "takeInbox",
      "writingState",
      "writingConfigure",
    ]),
    windowId: z.number().int().nonnegative(),
    accountId: z.uuid().optional(),
    connectionId: z.uuid().optional(),
    payload: z.unknown().optional(),
  })
  .strict();
const sourceInput = z.object({
  text: z.string().max(6000),
  source: webCaptureSchema,
});
const edit = z
  .object({
    text: z.string().max(6000).optional(),
    projectId: z.uuid().nullable().optional(),
    source: webCaptureSchema.nullable().optional(),
  })
  .strict();
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(() => ready).then(run);
  tail = result.catch(() => {});
  return result;
}
const inboxKey = (id: number) => `inbox:${id}`;
async function inbox(id: number) {
  const stored = await session.get(inboxKey(id));
  const schema = z.array(
    z.object({
      id: z.uuid(),
      text: z.string().max(6000),
      source: webCaptureSchema,
      createdAt: z.number(),
      accountId: z.uuid().nullable(),
    }),
  );
  const parsed = schema.safeParse(stored);
  const identity = (await session.get("identity")) as
    | { accountId: string }
    | undefined;
  const items = (parsed.success ? parsed.data : []).filter(
    (item) =>
      item.createdAt > Date.now() - 86400000 &&
      (!item.accountId || item.accountId === identity?.accountId),
  );
  if (items.length === 0) {
    if (stored !== undefined) await session.remove(inboxKey(id));
  } else if (JSON.stringify(stored) !== JSON.stringify(items))
    await session.set(inboxKey(id), items);
  return items;
}
async function dispatch(raw: unknown) {
  const message = request.parse(raw),
    id = message.windowId;
  if (message.kind === "preferences") return preferences();
  if (message.kind === "configure") {
    const changes = z
      .object({
        enabled: z.boolean().optional(),
        theme: z.enum(["system", "light", "dark"]).optional(),
      })
      .strict()
      .parse(message.payload);
    const next = preferenceSchema.parse({
      ...(await preferences()),
      ...changes,
    });
    await local.set("preferences", next);
    await menus();
    return next;
  }
  if (
    !(await preferences()).enabled &&
    !["logout", "writingState", "writingConfigure"].includes(message.kind)
  )
    throw new Error("Grove is turned off. Turn it on to continue.");
  if (!["state", "login", "inbox"].includes(message.kind)) {
    const current = (await session.get("identity")) as
      | { accountId: string; connectionId: string }
      | undefined;
    if (
      !current ||
      current.accountId !== message.accountId ||
      current.connectionId !== message.connectionId
    )
      throw new Error("Account changed. Reopen Grove before continuing.");
  }
  switch (message.kind) {
    case "writingState":
      return writing.read(message.accountId!);
    case "writingConfigure": {
      const result = await writing.configure(
        message.accountId!,
        message.payload,
      );
      await syncWritingSites();
      return result;
    }
    case "state":
      return client.state(id);
    case "login":
      return client.login(id);
    case "logout":
      await client.logout();
      await host.storage.session.clear();
      return true;
    case "edit":
      return client.edit(id, edit.parse(message.payload));
    case "save":
      return client.save(id);
    case "clear":
      return client.clear(id);
    case "notebooks":
      return client.notebooks(
        z.string().max(2048).optional().parse(message.payload),
      );
    case "search":
      return client.search(
        z
          .object({
            query: z.string().max(1000),
            projectId: z.uuid().nullable(),
            cursor: z.string().max(2048).optional(),
          })
          .strict()
          .parse(message.payload),
      );
    case "pages":
      return client.pages(
        z
          .object({
            url: z.string().max(4096),
            projectId: z.uuid().nullable(),
            cursor: z.string().max(2048).optional(),
          })
          .strict()
          .parse(message.payload),
      );
    case "read":
      return client.read(z.uuid().parse(message.payload));
    case "context":
      return client.context(
        z
          .array(
            z
              .object({ id: z.uuid(), version: z.number().int().positive() })
              .strict(),
          )
          .min(1)
          .max(6)
          .parse(message.payload),
      );
    case "reconcile":
      return client.reconcile(id, z.uuid().parse(message.payload));
    case "attach": {
      const tabs = await host.tabs.query({ active: true, windowId: id });
      const tab = tabs[0];
      if (!tab?.url || tab.incognito !== false)
        throw new Error(
          "Page access is unavailable. Use Grove from this page's context menu, or enter a source URL manually.",
        );
      return webCaptureSchema.parse({
        url: tab.url,
        title: tab.title ?? "",
        capturedAt: new Date().toISOString(),
      });
    }
    case "inbox":
      return inbox(id);
    case "takeInbox": {
      const items = await inbox(id),
        key = z.uuid().parse(message.payload),
        item = items.find((item) => item.id === key);
      if (!item) throw new Error("Capture expired or changed account.");
      await client.clear(id);
      const draft = await client.edit(id, sourceInput.parse(item));
      await session.set(
        inboxKey(id),
        items.filter((item) => item.id !== key),
      );
      return draft;
    }
  }
}
async function localWriting(raw: unknown) {
  await ready;
  const message = z
    .object({
      kind: z.enum(["writingCheck", "writingSuggest"]),
      windowId: z.number().int().nonnegative(),
      accountId: z.uuid(),
      connectionId: z.uuid(),
      payload: z
        .object({
          text: z.string().max(6000).optional(),
          word: z.string().max(24).optional(),
        })
        .strict(),
    })
    .strict()
    .parse(raw);
  const identity = (await session.get("identity")) as
    | { accountId: string; connectionId: string }
    | undefined;
  if (
    !identity ||
    identity.accountId !== message.accountId ||
    identity.connectionId !== message.connectionId ||
    !(await preferences()).enabled
  )
    throw new Error("Writing checks are paused or the account changed.");
  const before = await writing.read(identity.accountId);
  if (!before.settings.enabled) throw new Error("Writing assistance is off.");
  const checker = await localChecker();
  const after = await writing.read(identity.accountId);
  const current = (await session.get("identity")) as typeof identity;
  if (
    after.version !== before.version ||
    !(await preferences()).enabled ||
    current?.accountId !== identity.accountId ||
    current?.connectionId !== identity.connectionId
  )
    throw new Error("Writing settings changed. Check again.");
  if (message.kind === "writingSuggest")
    return before.settings.spelling
      ? checker.suggest(message.payload.word ?? "")
      : [];
  return checker.check(
    message.payload.text ?? "",
    effectiveWritingSettings(before.settings),
  );
}
async function websiteWriting(raw: unknown, sender: MessageSender) {
  const origin = writingSenderOrigin(sender, host.runtime.id);
  if (
    !origin ||
    !host.permissions ||
    !(await host.permissions.contains({
      origins: [writingSitePattern(origin, config.target)],
    }))
  )
    throw new Error("Website access is unavailable.");
  const message = z
    .object({
      kind: z.enum([
        "writingSiteState",
        "writingSiteCheck",
        "writingSiteSuggest",
        "writingSiteAddWord",
      ]),
      payload: z
        .object({
          text: z.string().max(6000).optional(),
          word: z.string().max(80).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .parse(raw);
  const current = (await session.get("identity")) as
    | { accountId: string; connectionId: string }
    | undefined;
  const enabled = (await preferences()).enabled;
  if (!current || !enabled) {
    if (message.kind === "writingSiteState")
      return { settings: writingSettingsSchema.parse({ enabled: false }) };
    throw new Error("Writing assistance is paused.");
  }
  const before = await writing.read(current.accountId),
    site = before.sites.find((site) => site.origin === origin);
  const settings = effectiveWritingSettings(
    before.settings,
    site?.restrictions,
    enabled && site?.enabled === true,
  );
  if (message.kind === "writingSiteState")
    return {
      settings: settings.enabled
        ? settings
        : writingSettingsSchema.parse({ enabled: false }),
    };
  if (!settings.enabled)
    throw new Error("Writing assistance is off for this site.");
  if (message.kind === "writingSiteAddWord") {
    if (!settings.spelling) throw new Error("Spelling is off for this site.");
    return serial(async () => {
      if (
        ((await session.get("identity")) as typeof current)?.accountId !==
          current.accountId ||
        !(await preferences()).enabled
      )
        throw new Error("Account changed.");
      await writing.configure(current.accountId, {
        addWord: message.payload?.word,
      });
      await refreshWritingTabs();
      return true;
    });
  }
  const checker = await localChecker();
  const after = await writing.read(current.accountId),
    identity = (await session.get("identity")) as typeof current;
  if (
    before.version !== after.version ||
    identity?.accountId !== current.accountId ||
    identity?.connectionId !== current.connectionId ||
    !(await preferences()).enabled ||
    !(await host.permissions.contains({
      origins: [writingSitePattern(origin, config.target)],
    }))
  )
    throw new Error("Writing settings changed. Check again.");
  if (message.kind === "writingSiteSuggest")
    return settings.spelling
      ? checker.suggest(message.payload?.word ?? "")
      : [];
  return checker.check(message.payload?.text ?? "", settings);
}
host.runtime.onMessage.addListener((message, sender, respond) => {
  const panel = trustedPanel(sender, host.runtime);
  if (!panel && !writingSenderOrigin(sender, host.runtime.id)) return false;
  // Dictionary parsing and candidate generation run off the editor's UI thread and
  // do not hold the capture/auth/settings state-transition queue while awaiting load.
  const kind = (message as { kind?: string })?.kind;
  void (
    !panel
      ? websiteWriting(message, sender)
      : kind === "writingCheck" || kind === "writingSuggest"
        ? localWriting(message)
        : serial(() => dispatch(message))
  ).then(
    (data) => respond({ ok: true, data }),
    (error) =>
      respond({
        ok: false,
        error: {
          code: error instanceof GroveError ? error.code : "unavailable",
          status: error instanceof GroveError ? error.status : 0,
          message:
            error instanceof z.ZodError
              ? "The request could not be verified."
              : error instanceof Error
                ? error.message
                : "Grove could not complete this request.",
        },
      }),
  );
  return true;
});
async function refreshWritingTabs() {
  if (!host.tabs.sendMessage) return;
  const tabs = await host.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) =>
        host.tabs.sendMessage!(tab.id!, { kind: "writingRefresh" }).catch(
          () => {},
        ),
      ),
  );
}
async function syncWritingSites() {
  if (!host.scripting || !host.permissions) return;
  const registered = (
    await host.scripting.getRegisteredContentScripts()
  ).filter((script) => script.id.startsWith("grove-writing-"));
  if (registered.length)
    await host.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    });
  const identity = (await session.get("identity")) as
    | { accountId: string }
    | undefined;
  if (identity && (await preferences()).enabled) {
    const current = await writing.read(identity.accountId);
    const sites = current.settings.enabled
      ? current.sites
          .filter((site) => site.enabled)
          .sort((a, b) => a.origin.localeCompare(b.origin))
      : [];
    const scripts = [];
    for (const [index, site] of sites.entries()) {
      const pattern = writingSitePattern(site.origin, config.target);
      if (await host.permissions.contains({ origins: [pattern] }))
        scripts.push({
          id: `grove-writing-${index}`,
          matches: [pattern],
          js: ["content.js"],
          runAt: "document_idle" as const,
          allFrames: false,
          persistAcrossSessions: false,
        });
    }
    if (scripts.length) await host.scripting.registerContentScripts(scripts);
  }
  await refreshWritingTabs();
}
host.permissions?.onRemoved.addListener(() => {
  void serial(syncWritingSites).catch(() => {});
});
host.storage.onChanged.addListener((changes, area) => {
  if (
    (area === "local" && changes.preferences) ||
    (area === "session" && changes.identity)
  )
    void serial(syncWritingSites).catch(() => {});
});
async function menus() {
  enabled = (await preferences()).enabled;
  await host.contextMenus.removeAll();
  await host.action.setBadgeText({ text: enabled ? "" : "OFF" });
  await host.action.setBadgeBackgroundColor({ color: "#5e625e" });
  await host.action.setTitle({
    title: enabled ? "Open Grove" : "Grove is off — open to turn on",
  });
  if (!enabled) return;
  for (const [id, title, contexts] of [
    ["grove-capture-selection", "Save selection to Grove", ["selection"]],
    ["grove-capture-link", "Save link to Grove", ["link"]],
    ["grove-capture-page", "Save page link to Grove", ["page"]],
  ] as const)
    host.contextMenus.create({
      id,
      title,
      contexts: [...contexts],
      documentUrlPatterns: ["https://*/*", "http://*/*"],
    });
}
async function recordEntryError(id: number, message: string) {
  await session.set(`entryError:${id}`, message);
}
host.runtime.onInstalled.addListener(() => {
  void serial(menus).catch(() =>
    recordEntryError(
      0,
      "Browser menus could not be registered. Reload the extension.",
    ),
  );
});
host.runtime.onStartup.addListener(() => {
  void serial(menus).catch(() =>
    recordEntryError(
      0,
      "Browser menus could not be registered. Reload the extension.",
    ),
  );
});
host.action.onClicked.addListener((tab) => {
  const id = tab.windowId;
  if (id === undefined || tab.incognito !== false) return;
  try {
    void openNativePanel(config.target, host, id).catch(() =>
      recordEntryError(
        id,
        "The native panel could not be opened. Try the toolbar again.",
      ),
    );
  } catch {
    void recordEntryError(
      id,
      "Native panel unavailable in this browser version.",
    );
  }
});
host.contextMenus.onClicked.addListener((event, tab) => {
  const id = tab?.windowId;
  if (!enabled || id === undefined || tab?.incognito !== false) return;
  // Open before any promise/network work so native gesture attribution survives.
  try {
    void openNativePanel(config.target, host, id).catch(() =>
      recordEntryError(
        id,
        "Open Grove from the toolbar to review the captured selection.",
      ),
    );
  } catch {
    void recordEntryError(
      id,
      "Open Grove from the toolbar to review this capture.",
    );
  }
  void serial(async () => {
    if (!(await preferences()).enabled) return;
    const capture =
      event.menuItemId === "grove-capture-page"
        ? {
            text: "",
            source: webCaptureSchema.parse({
              url: event.pageUrl ?? tab.url,
              title: tab.title ?? "",
              capturedAt: new Date().toISOString(),
            }),
          }
        : contextMenuCapture(event, tab, Date.now());
    if (!capture) return;
    const existing = await inbox(id);
    if (existing.length >= 5)
      throw new Error(
        "Five captures are waiting. Review or clear them before adding another.",
      );
    const identity = (await session.get("identity")) as
      | { accountId: string }
      | undefined;
    await session.set(inboxKey(id), [
      ...existing,
      {
        id: crypto.randomUUID(),
        ...capture,
        accountId: identity?.accountId ?? null,
        createdAt: Date.now(),
      },
    ]);
  }).catch((error) =>
    recordEntryError(
      id,
      error instanceof Error ? error.message : "Capture could not be prepared.",
    ),
  );
});
host.windows.onRemoved.addListener((id) => {
  void serial(async () => {
    await host.storage.session.remove([
      `draft:${id}`,
      inboxKey(id),
      `entryError:${id}`,
    ]);
  });
});
// Restore persisted controls whenever an MV3 worker/event page is resumed.
void serial(menus).catch(() =>
  recordEntryError(
    0,
    "Browser controls could not be updated. Reopen Grove to check its state.",
  ),
);
void serial(syncWritingSites).catch(() => {});
