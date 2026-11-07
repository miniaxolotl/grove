import { z } from "zod";
import {
  writingRequestSchema,
  unavailableWriting,
  type WritingAvailability,
} from "@lib/shared/writing-assistance";
import { GroveError } from "@lib/shared/contracts";
import { webCaptureSchema } from "@lib/shared/web-capture";
import { NOTE_CONTENT_MAX } from "@lib/shared/limits";
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
import { contextMenuCapture, openNativePanel, tabSource } from "./platform.ts";
import { ensureGrace, readGrace } from "./grace.ts";
import {
  WritingPreferencesStore,
  writingSettingsFor,
  writingBrowserKey,
} from "./writing/preferences.ts";
import {
  effectiveWritingSettings,
  writingSettingsSchema,
} from "./writing/core.ts";

const local = storageAdapter(host.storage.local),
  session = storageAdapter(host.storage.session);
const oauth = new BrowserOAuth(config, local, session, host.identity);
const client = new ExtensionClient(config, local, session, oauth);
const writing = new WritingPreferencesStore(local, config.apiOrigin, () =>
  host.storage.local.get(null),
);
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
      "read",
      "sharing",
      "publish",
      "unshare",
      "reconcile",
      "attach",
      "followSource",
      "inbox",
      "takeInbox",
      "writingState",
      "writingConfigure",
      "grace",
    ]),
    windowId: z.number().int().nonnegative(),
    accountId: z.uuid().optional(),
    connectionId: z.uuid().optional(),
    payload: z.unknown().optional(),
  })
  .strict();
const sourceInput = z.object({
  text: z.string().max(NOTE_CONTENT_MAX),
  source: webCaptureSchema,
});
const edit = z
  .object({
    text: z.string().max(NOTE_CONTENT_MAX).optional(),
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
      text: z.string().max(NOTE_CONTENT_MAX),
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
  if (message.kind === "grace")
    return readGrace(host.storage.local, host.storage.sync);
  if (message.kind === "writingState" || message.kind === "writingConfigure") {
    const identity = (await session.get("identity")) as
      | { accountId: string; connectionId: string }
      | undefined;
    if (
      message.accountId &&
      (message.accountId !== identity?.accountId ||
        message.connectionId !== identity?.connectionId)
    )
      throw new Error("Account changed. Reopen Grove.");
    if (message.kind === "writingState")
      return writing.read(identity?.accountId);
    const result = await writing.configure(
      identity?.accountId,
      message.payload,
    );
    await refreshWritingTabs();
    await fenceWritingEffects(result);
    return result;
  }
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
    await refreshWritingTabs();
    if (!next.enabled) await fenceWritingEffects();
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
    case "state":
      return client.state(id);
    case "login":
      return client.login(id);
    case "logout": {
      let cancellationUncertain = false;
      try {
        await fenceWritingEffects();
      } catch {
        cancellationUncertain = true;
      }
      await client.logout();
      await host.storage.session.clear();
      if (cancellationUncertain)
        throw new Error(
          "Signed out locally. Server cancellation could not be confirmed; pending AI requests expire after 15 minutes and cannot restore this signed-out session.",
        );
      return true;
    }
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
            cursor: z.string().max(2048).optional(),
          })
          .strict()
          .parse(message.payload),
      );
    case "read":
      return client.read(z.uuid().parse(message.payload));
    case "sharing":
      return client.sharing(z.uuid().parse(message.payload));
    case "publish": {
      const input = z
        .object({
          id: z.uuid(),
          expectedVersion: z.number().int().min(0),
          expectedTargetVersion: z.number().int().positive(),
          duration: z.enum(["1h", "4h", "1d", "1w", "2w", "1mo"]).nullable(),
        })
        .strict()
        .parse(message.payload);
      const { id: noteId, ...settings } = input;
      return client.publish(noteId, { ...settings, includeDescendants: false });
    }
    case "unshare": {
      const input = z
        .object({
          id: z.uuid(),
          shareId: z.uuid(),
          expectedVersion: z.number().int().positive(),
        })
        .strict()
        .parse(message.payload);
      return client.unshare(input.id, input.shareId, input.expectedVersion);
    }
    case "reconcile":
      return client.reconcile(id, z.uuid().parse(message.payload));
    case "followSource": {
      const [tab] = await host.tabs.query({ active: true, windowId: id });
      return client.followSource(id, tabSource(tab, Date.now()));
    }
    case "attach": {
      const [tab] = await host.tabs.query({ active: true, windowId: id });
      const source = tabSource(tab, Date.now());
      if (!source)
        throw new Error(
          "Page access is unavailable. Use Grove from this page's context menu, or enter a source URL manually.",
        );
      return source;
    }
    case "inbox":
      return inbox(id);
    case "takeInbox": {
      const items = await inbox(id),
        key = z.uuid().parse(message.payload),
        item = items.find((item) => item.id === key);
      if (!item) throw new Error("Capture expired or changed account.");
      await client.clear(id);
      const draft = await client.edit(id, {
        ...sourceInput.parse(item),
        textOrigin: "quoted",
      });
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
          text: z.string().max(NOTE_CONTENT_MAX).optional(),
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
          text: z.string().max(NOTE_CONTENT_MAX).optional(),
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
  if (!enabled) {
    if (message.kind === "writingSiteState")
      return { settings: writingSettingsSchema.parse({ enabled: false }) };
    throw new Error("Writing assistance is paused.");
  }
  const before = await writing.read(current?.accountId);
  const settings = writingSettingsFor(before, origin, enabled);
  if (message.kind === "writingSiteState") {
    const identity = (await session.get("identity")) as {
      writingTools?: WritingAvailability;
    };
    let binding: string | null = null;
    if (
      current &&
      settings.enabled &&
      settings.aiRewrites &&
      sender.documentId
    ) {
      binding = crypto.randomUUID();
      await session.set(`writingBinding:${binding}`, {
        accountId: current.accountId,
        connectionId: current.connectionId,
        origin,
        tabId: sender.tab!.id,
        documentId: sender.documentId,
        ids: [],
        createdAt: Date.now(),
      });
    }
    return {
      binding,
      tools: identity?.writingTools ?? unavailableWriting,
      settings: settings.enabled
        ? settings
        : writingSettingsSchema.parse({ enabled: false }),
    };
  }
  if (!settings.enabled)
    throw new Error("Writing assistance is off for this site.");
  if (message.kind === "writingSiteAddWord") {
    if (!settings.spelling) throw new Error("Spelling is off for this site.");
    return serial(async () => {
      if (
        ((await session.get("identity")) as typeof current)?.accountId !==
          current?.accountId ||
        !(await preferences()).enabled
      )
        throw new Error("Account changed.");
      if (
        !writingSettingsFor(
          await writing.read(current?.accountId),
          origin,
          (await preferences()).enabled,
        ).spelling
      )
        throw new Error("Spelling is off for this domain.");
      await writing.configure(current?.accountId, {
        addWord: message.payload?.word,
      });
      await refreshWritingTabs();
      return true;
    });
  }
  const checker = await localChecker();
  const after = await writing.read(current?.accountId),
    identity = (await session.get("identity")) as typeof current;
  if (
    before.version !== after.version ||
    identity?.accountId !== current?.accountId ||
    identity?.connectionId !== current?.connectionId ||
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
type WritingBinding = {
  accountId: string;
  connectionId: string;
  origin?: string;
  tabId?: number;
  documentId?: string;
  ids: string[];
  active?: string[];
  createdAt: number;
};
async function fenceWritingEffects(
  state?: Awaited<ReturnType<typeof writing.read>>,
  removedPermissions = false,
) {
  const identity = (await session.get("identity")) as
    | { accountId: string; connectionId: string }
    | undefined;
  if (!identity) return;
  const entries = Object.entries(await host.storage.session.get(null)).filter(
    ([key]) =>
      key.startsWith("writingBinding:") || key.startsWith("writingPanel:"),
  );
  for (const [key, raw] of entries) {
    const binding = raw as WritingBinding;
    if (
      binding.accountId !== identity.accountId ||
      binding.connectionId !== identity.connectionId ||
      !binding.active?.length
    )
      continue;
    if (removedPermissions) {
      if (
        !binding.origin ||
        (await host.permissions?.contains({
          origins: [writingSitePattern(binding.origin, config.target)],
        }))
      )
        continue;
    } else if (
      state &&
      (binding.origin
        ? writingSettingsFor(state, binding.origin)
        : state.settings
      ).enabled &&
      (binding.origin
        ? writingSettingsFor(state, binding.origin)
        : state.settings
      ).aiRewrites
    )
      continue;
    for (const id of binding.active) {
      try {
        await client.cancelWriting(id);
      } catch {
        throw new Error(
          "AI tools are paused here, but server cancellation could not be confirmed. Pending requests expire after 15 minutes; reopen Grove to reconcile them.",
        );
      }
    }
    binding.active = [];
    await session.set(key, binding);
  }
}
async function aiWriting(raw: unknown, sender: MessageSender, panel: boolean) {
  await ready;
  const message = z
    .object({
      kind: z.enum([
        "writingAIConsent",
        "writingAIRequest",
        "writingAIGet",
        "writingAICancel",
      ]),
      windowId: z.number().int().nonnegative().optional(),
      accountId: z.uuid().optional(),
      connectionId: z.uuid().optional(),
      binding: z.uuid().optional(),
      payload: z.unknown(),
    })
    .strict()
    .parse(raw);
  const identity = (await session.get("identity")) as
    | {
        accountId: string;
        connectionId: string;
        writingTools?: WritingAvailability;
      }
    | undefined;
  if (!identity)
    throw new Error("Connect Grove before using AI writing tools.");
  const origin = panel
    ? undefined
    : writingSenderOrigin(sender, host.runtime.id);
  const key = panel
    ? `writingPanel:${message.windowId}:${identity.connectionId}`
    : `writingBinding:${message.binding}`;
  let binding = (await session.get(key)) as WritingBinding | undefined;
  if (panel) {
    if (
      message.windowId === undefined ||
      message.accountId !== identity.accountId ||
      message.connectionId !== identity.connectionId
    )
      throw new Error("Account changed.");
    binding ??= {
      accountId: identity.accountId,
      connectionId: identity.connectionId,
      ids: [],
      createdAt: Date.now(),
    };
  } else if (
    !origin ||
    !sender.documentId ||
    !binding ||
    binding.origin !== origin ||
    binding.tabId !== sender.tab?.id ||
    binding.documentId !== sender.documentId ||
    !host.permissions ||
    !(await host.permissions.contains({
      origins: [writingSitePattern(origin, config.target)],
    }))
  )
    throw new Error("Website writing session changed. Select your text again.");
  if (
    !binding ||
    binding.accountId !== identity.accountId ||
    binding.connectionId !== identity.connectionId
  )
    throw new Error("Writing session expired. Select your text again.");
  const current = await writing.read(identity.accountId);
  const settings = origin
    ? writingSettingsFor(current, origin, (await preferences()).enabled)
    : effectiveWritingSettings(
        current.settings,
        {},
        (await preferences()).enabled,
      );
  const revoke =
    message.kind === "writingAIConsent" &&
    z.object({ accepted: z.boolean() }).parse(message.payload).accepted ===
      false;
  if (!settings.enabled || !settings.aiRewrites) {
    if (message.kind !== "writingAICancel" && !revoke)
      throw new Error("AI writing tools are off.");
  }
  if (message.kind === "writingAIConsent") {
    const input = z
      .object({ policy: z.string().max(100), accepted: z.boolean() })
      .strict()
      .parse(message.payload);
    return client.writingConsent(input.policy, input.accepted);
  }
  if (message.kind === "writingAIRequest") {
    const input = writingRequestSchema.parse(message.payload);
    if (Date.now() - binding.createdAt > 900000) {
      // Server-side work has reached its fixed expiry. A fresh explicit request
      // renews opaque ownership in the same authenticated document, not old text.
      binding = { ...binding, ids: [], active: [], createdAt: Date.now() };
    }
    if (!binding.ids.includes(input.id)) {
      while (binding.ids.length >= 20) {
        const finished = binding.ids.findIndex(
          (id) => !binding?.active?.includes(id),
        );
        if (finished < 0) break;
        binding.ids.splice(finished, 1);
      }
      if (binding.ids.length >= 20)
        throw new Error(
          "Wait for pending writing requests before generating more alternatives.",
        );
      // Persist only opaque ownership before remote acceptance; an uncertain POST
      // remains reconcilable through this exact ID, never a blind new request.
      binding.ids.push(input.id);
      await session.set(key, binding);
    }
    binding.active = [...new Set([...(binding.active ?? []), input.id])];
    await session.set(key, binding);
    const work = await client.writingRequest(input);
    if (
      !["queued", "processing", "backoff", "recovering"].includes(work.status)
    ) {
      binding.active = binding.active.filter((id) => id !== input.id);
      await session.set(key, binding);
    }
    return work;
  }
  const id = z.uuid().parse(message.payload);
  if (!binding.ids.includes(id))
    throw new Error("This request belongs to another writing session.");
  const work =
    message.kind === "writingAICancel"
      ? await client.cancelWriting(id)
      : await client.writingWork(id);
  if (
    message.kind === "writingAICancel" ||
    (work &&
      typeof work === "object" &&
      "status" in work &&
      !["queued", "processing", "backoff", "recovering"].includes(
        String(work.status),
      ))
  ) {
    binding.active = binding.active?.filter((active) => active !== id);
    await session.set(key, binding);
  }
  return work;
}
host.runtime.onMessage.addListener((message, sender, respond) => {
  const panel = trustedPanel(sender, host.runtime);
  if (!panel && !writingSenderOrigin(sender, host.runtime.id)) return false;
  // Dictionary parsing and candidate generation run off the editor's UI thread and
  // do not hold the capture/auth/settings state-transition queue while awaiting load.
  const kind = (message as { kind?: string })?.kind;
  void (
    typeof kind === "string" && kind.startsWith("writingAI")
      ? aiWriting(message, sender, panel)
      : !panel
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
  await writing.read();
  if (!host.scripting) {
    await refreshWritingTabs();
    return;
  }
  const registered = (
    await host.scripting.getRegisteredContentScripts()
  ).filter((script) => script.id.startsWith("grove-writing-"));
  if (registered.length)
    await host.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    });
  await refreshWritingTabs();
}
host.permissions?.onRemoved.addListener(() => {
  void serial(async () => {
    await fenceWritingEffects(undefined, true);
    await syncWritingSites();
  }).catch(() => {});
});
host.storage.onChanged.addListener((changes, area) => {
  const before = changes.identity?.oldValue as
    | { accountId?: string; connectionId?: string }
    | undefined;
  const after = changes.identity?.newValue as typeof before;
  const identityChanged =
    !!changes.identity &&
    (before?.accountId !== after?.accountId ||
      before?.connectionId !== after?.connectionId);
  if (area === "session" && changes.identity && !identityChanged) {
    const tools =
      (
        changes.identity.newValue as
          | { writingTools?: WritingAvailability }
          | undefined
      )?.writingTools ?? unavailableWriting;
    void serial(async () => {
      const tabs = await host.tabs.query({});
      await Promise.all(
        tabs
          .filter((tab) => tab.id !== undefined)
          .map((tab) =>
            host.tabs
              .sendMessage?.(tab.id!, { kind: "writingToolsState", tools })
              .catch(() => {}),
          ),
      );
    }).catch(() => {});
  }
  if (
    (area === "local" && (changes.preferences || changes[writingBrowserKey])) ||
    (area === "session" && identityChanged)
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
  void serial(() => ensureGrace(host.storage.local, host.storage.sync)).catch(
    () => {},
  );
  void serial(async () => {
    await syncWritingSites();
    for (const tab of await host.tabs.query({}))
      if (
        tab.id !== undefined &&
        tab.incognito === false &&
        tab.url &&
        /^https?:\/\//.test(tab.url)
      )
        await host.scripting
          ?.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
          .catch(() => {});
  }).catch(() => {});
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
