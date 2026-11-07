import type { Memory } from "@lib/shared/contracts";
import { unavailableWriting } from "@lib/shared/writing-assistance";
import type { CaptureDraft } from "./drafts.ts";
import { formatCaptureDraft } from "./drafts.ts";
import type { ExtensionClient } from "./client.ts";
import { renderNote } from "./reader.ts";
import { ShareController } from "./sharing.ts";
import { userMessage } from "./messages.ts";
import { copyText } from "./writing/clipboard.ts";
import { nativeBrowser as host, extensionConfig } from "./webextension.ts";
import { WritingController } from "./writing/controller.ts";
import {
  effectiveWritingSettings,
  writingRules,
  writingSettingsSchema,
  type WritingPatch,
} from "./writing/core.ts";
import {
  writingBrowserKey,
  type WritingPreferences,
} from "./writing/preferences.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
type State = Awaited<ReturnType<ExtensionClient["state"]>>;
type Inbox = {
  id: string;
  text: string;
  source: { url: string; title: string };
};
let state: State | undefined,
  windowId = 0,
  view = "capture";
let sessionEpoch = 0;
type Preferences = { enabled: boolean; theme: "system" | "light" | "dark" };
let preferences: Preferences = { enabled: true, theme: "system" };
let configuring = false;
let writingPreferences: WritingPreferences | undefined;
let visibleWords = 10;
const writingController = new WritingController(
  $<HTMLTextAreaElement>("note"),
  {
    settings: () =>
      effectiveWritingSettings(
        writingPreferences?.settings ??
          writingSettingsSchema.parse({ enabled: false }),
        {},
        preferences.enabled && !!state && approved(),
      ),
    check: (text) => rpc("writingCheck", { text }),
    suggest: (word) => rpc("writingSuggest", { word }),
    tools: {
      availability: () => state?.identity.writingTools ?? unavailableWriting,
      consent: async (accepted) => {
        const result = await rpc<
          import("@lib/shared/writing-assistance").WritingAvailability
        >("writingAIConsent", {
          policy:
            state?.identity.writingTools?.policy ?? unavailableWriting.policy,
          accepted,
        });
        if (state) state.identity.writingTools = result;
        return result;
      },
      request: (input) => rpc("writingAIRequest", input),
      get: (id) => rpc("writingAIGet", id),
      cancel: (id) => rpc("writingAICancel", id),
    },
    addWord: (word) => saveWriting({ addWord: word }),
    feedback: (message) => {
      $("writing-hint").textContent = message;
      $("writing-hint").hidden = false;
    },
    status: (result, error) => {
      const button = $<HTMLButtonElement>("writing-review");
      button.textContent = error
        ? "Retry writing checks"
        : result?.issues.length
          ? `${result.issues.length} suggestion${result.issues.length === 1 ? "" : "s"}`
          : "Check writing";
      button.title = error
        ? "Writing checks are unavailable. Try again."
        : result && !result.complete
          ? "Text after 6,000 characters is unchecked."
          : "Spelling and basic grammar · Alt+Enter";
      button.hidden =
        !error &&
        !result?.issues.length &&
        (writingPreferences?.settings.automatic ?? true);
      $("writing-hint").hidden = !button.hidden;
    },
  },
);
function paintWriting() {
  const settings = writingPreferences?.settings;
  for (const key of [
    "enabled",
    "spelling",
    "grammar",
    "aiRewrites",
    "automatic",
    "highlights",
  ] as const) {
    const input = $<HTMLInputElement>(writingControlId(key));
    input.checked = settings?.[key] ?? false;
    input.disabled = !settings;
  }
  for (const rule of writingRules) {
    const input = $<HTMLInputElement>(`writing-rule-${rule}`);
    if (input) {
      input.checked = settings?.rules[rule] ?? false;
      input.disabled = !settings;
    }
  }
  const words = $("writing-words");
  const wordRows = new Map(
    [...words.querySelectorAll<HTMLButtonElement>("button")].map((button) => [
      button.dataset.word,
      button,
    ]),
  );
  for (const word of settings?.words.slice(0, visibleWords) ?? []) {
    if (wordRows.has(word)) {
      wordRows.delete(word);
      continue;
    }
    const button = document.createElement("button");
    button.dataset.word = word;
    button.type = "button";
    button.textContent = word;
    button.setAttribute(
      "aria-label",
      `Remove ${word} from personal dictionary`,
    );
    button.addEventListener("click", () => {
      void action(() => saveWriting({ removeWord: word }));
    });
    words.append(button);
  }
  for (const button of wordRows.values()) button.remove();
  $("writing-words-more").hidden =
    (settings?.words.length ?? 0) <= visibleWords;
  const sites = $("writing-sites");
  const siteRows = new Map(
    [...sites.querySelectorAll<HTMLDetailsElement>(":scope > details")].map(
      (row) => [row.dataset.domain, row],
    ),
  );
  for (const site of writingPreferences?.sites ?? []) {
    const existing = siteRows.get(site.domain);
    if (existing) {
      existing.querySelector<HTMLInputElement>(
        "[data-feature='enabled']",
      )!.checked = site.enabled;
      for (const key of ["spelling", "grammar", "aiRewrites"] as const)
        existing.querySelector<HTMLInputElement>(
          `[data-feature='${key}']`,
        )!.checked = site.restrictions[key] !== false;
      siteRows.delete(site.domain);
      continue;
    }
    const domain = site.domain;
    const detail = document.createElement("details"),
      title = document.createElement("summary");
    detail.dataset.domain = domain;
    title.textContent = domain;
    detail.append(title);
    const makeToggle = (
      labelText: string,
      checked: boolean,
      key: string,
      run: (checked: boolean) => Promise<void>,
    ) => {
      const label = document.createElement("label");
      label.className = "writing-option";
      const text = document.createElement("span");
      text.textContent = labelText;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.dataset.feature = key;
      input.setAttribute("role", "switch");
      input.addEventListener("change", () => {
        void action(async () => {
          try {
            await run(input.checked);
          } finally {
            paintWriting();
          }
        });
      });
      label.append(text, input);
      detail.append(label);
    };
    makeToggle(
      "Check this domain",
      site.enabled,
      "enabled",
      async (enabled) => {
        await saveWriting({ site: { domain, enabled } });
      },
    );
    for (const key of ["spelling", "grammar", "aiRewrites"] as const)
      makeToggle(
        key === "spelling"
          ? "Allow spelling"
          : key === "grammar"
            ? "Allow grammar"
            : "Allow AI writing tools",
        site.restrictions[key] !== false,
        key,
        (enabled) =>
          saveWriting({
            site: {
              domain,
              enabled:
                writingPreferences?.sites.find((site) => site.domain === domain)
                  ?.enabled ?? true,
              restrictions: { [key]: enabled },
            },
          }),
      );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove exception";
    remove.addEventListener("click", () => {
      void action(async () => {
        await saveWriting({ removeDomain: domain });
      });
    });
    detail.append(remove);
    sites.append(detail);
  }
  for (const row of siteRows.values()) row.remove();
  $<HTMLButtonElement>("writing-review").disabled =
    !settings ||
    !preferences.enabled ||
    !settings.enabled ||
    (!settings.spelling && !settings.grammar);
  writingController.refresh();
}
async function saveWriting(change: {
  patch?: WritingPatch;
  addWord?: string;
  removeWord?: string;
  site?: { domain: string; enabled: boolean; restrictions?: WritingPatch };
  removeDomain?: string;
}) {
  $("writing-settings-status").textContent = "Saving…";
  try {
    writingPreferences = await rpc<WritingPreferences>(
      "writingConfigure",
      change,
    );
    $("writing-settings-status").textContent = "Saved on this device.";
  } catch (error) {
    $("writing-settings-status").textContent = "Not saved. Try again.";
    throw error;
  } finally {
    paintWriting();
  }
}
let searchRevision = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let composingSearch = false;
let draftRevision = 0;
let readerNote: Memory | undefined;
let readerRevision = 0;
let savingCapture = false;
let notebookCursor: string | null = null;
const renderedNotes = new WeakMap<HTMLElement, Memory>();
const scrollPositions = new Map<string, number>();
let editTail: Promise<unknown> = Promise.resolve(),
  replaceAction: (() => Promise<void>) | undefined;
const approved = () =>
  state?.identity.capabilities.some((cap) =>
    ["memory:read", "memory:write"].includes(cap),
  ) ?? false;
const recallView = () => view === "search";
const sharing = new ShareController({
  rpc,
  siteOrigin: extensionConfig.siteOrigin,
  approvalUrl,
});
function closeDialogs() {
  for (const dialog of document.querySelectorAll("dialog")) dialog.close();
}
function notice(message = "") {
  $("notice").textContent = message;
  $("notice-area").hidden = !message;
}
async function rpc<T>(kind: string, payload?: unknown): Promise<T> {
  const epoch = sessionEpoch;
  const scope = state?.identity;
  const result = (await host.runtime.sendMessage({
    kind,
    windowId,
    ...(state
      ? {
          accountId: state.identity.accountId,
          connectionId: state.identity.connectionId,
        }
      : {}),
    ...(payload === undefined ? {} : { payload }),
  })) as {
    ok: boolean;
    data: T;
    error?: { message: string; code: string; status: number };
  };
  if (!result?.ok)
    throw Object.assign(new Error(userMessage(result?.error)), {
      code: result?.error?.code,
    });
  if (
    epoch !== sessionEpoch &&
    !["logout", "configure", "preferences", "grace"].includes(kind)
  )
    throw new Error("Connection changed. Reopen Grove before continuing.");
  if (
    scope &&
    !["state", "login", "logout", "configure", "preferences", "grace"].includes(
      kind,
    ) &&
    (scope.accountId !== state?.identity.accountId ||
      scope.connectionId !== state?.identity.connectionId)
  )
    throw new Error("Connection changed. Reopen Grove before continuing.");
  return result.data;
}
async function action(run: () => Promise<void>) {
  try {
    notice();
    await run();
  } catch (error) {
    notice(userMessage(error));
  }
}
function on(id: string, run: () => Promise<void>) {
  $(id).addEventListener("click", () => {
    void action(run);
  });
}
function show(next: string) {
  const main = document.querySelector("main")!;
  const switched = next !== view;
  if (switched)
    document
      .querySelectorAll<HTMLDetailsElement>(".note-menu[open]")
      .forEach((menu) => {
        menu.open = false;
      });
  if (switched) scrollPositions.set(view, main.scrollTop);
  view = next;
  document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((el) => (el.hidden = el.dataset.view !== next));
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    if (el.dataset.nav === next) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("workspace").hidden =
    !preferences.enabled || !approved() || next === "settings";
  $("welcome").hidden = !preferences.enabled || !!state || next === "settings";
  $("approval").hidden =
    !preferences.enabled || !state || approved() || next === "settings";
  $("paused").hidden = preferences.enabled || next === "settings";
  $("navigation").hidden = false;
  document
    .querySelectorAll<HTMLButtonElement>("[data-nav]")
    .forEach((button) => {
      button.disabled =
        button.dataset.nav !== "settings" &&
        (!preferences.enabled || !approved());
    });
  $("recall-results").hidden = !recallView();
  if (recallView()) paintResults();
  if (switched) main.scrollTop = scrollPositions.get(next) ?? 0;
  writingController.refresh();
}
function paintPreferences(next: Preferences) {
  const turningOff = preferences.enabled && !next.enabled;
  preferences = next;
  document.documentElement.dataset.theme = next.theme;
  $<HTMLSelectElement>("theme").value = next.theme;
  $("extension-toggle").setAttribute("aria-checked", String(next.enabled));
  $("extension-status").textContent = next.enabled ? "On" : "Off";
  $("pending-list").hidden = !next.enabled || !state;
  $("recovery-help").hidden = next.enabled && !!state;
  $("recovery-settings").hidden = !state?.pending.length;
  $("connection-help").hidden = !!state;
  $("connection-settings").hidden = !state;
  $("signout-settings").hidden = !state;
  if (state)
    $("connection-state").textContent = !next.enabled
      ? "Paused"
      : approved()
        ? "Signed in"
        : "Awaiting your approval";
  $<HTMLButtonElement>("refresh").disabled = !next.enabled;
  $<HTMLButtonElement>("notebooks-more").disabled = !next.enabled;
  if (turningOff) {
    sessionEpoch++;
    cancelSearch();
    if ($<HTMLInputElement>("query").value.trim()) {
      resultState.status = "Search paused. Earlier results below.";
      resultState.cursor = null;
    }
    closeDialogs();
  }
  show(view);
  if (writingPreferences) paintWriting();
}
async function configure(changes: Partial<Preferences>) {
  const focused = document.activeElement as HTMLElement | null;
  configuring = true;
  for (const id of ["extension-toggle", "theme"])
    $<HTMLButtonElement>(id).disabled = true;
  $("extension-toggle").setAttribute("aria-busy", "true");
  if (changes.enabled === false) $("extension-status").textContent = "…";
  try {
    await editTail;
    const previous = preferences.enabled;
    paintPreferences(await rpc<Preferences>("configure", changes));
    if (!previous && preferences.enabled) await connectView();
  } finally {
    configuring = false;
    $("extension-toggle").removeAttribute("aria-busy");
    paintPreferences(preferences);
    for (const id of ["extension-toggle", "theme"])
      $<HTMLButtonElement>(id).disabled = false;
    if (
      document.activeElement === document.body &&
      focused?.isConnected &&
      !focused.closest("[hidden]")
    )
      focused.focus({ preventScroll: true });
  }
}
function approvalUrl() {
  return `${extensionConfig.siteOrigin}/app/connections#connection-${state!.identity.connectionId}`;
}
function noteUrl(id: string) {
  return `${extensionConfig.siteOrigin}/app/memories/${id}`;
}
function updateNotebooks(items: State["notebooks"]["items"], append = false) {
  if (!state) return;
  const choices = append ? [...state.notebooks.items, ...items] : items;
  state.notebooks.items = [
    ...new Map(choices.map((item) => [item.id, item])).values(),
  ];
  document
    .querySelectorAll<HTMLSelectElement>(".notebook-select")
    .forEach((select) => {
      const previous = select.value;
      select.replaceChildren();
      if (state!.identity.grant.personal)
        select.add(new Option("Personal", ""));
      for (const item of state!.notebooks.items)
        select.add(new Option(item.name, item.id));
      const value =
        select.id === "destination"
          ? (state!.draft?.projectId ?? "")
          : previous;
      if (
        ![...select.options].some((option) => option.value === value) &&
        value
      )
        select.add(new Option("Saved notebook (check access)", value));
      select.value = value;
    });
  $("notebooks-more").hidden = !notebookCursor;
}
function paintDraft(draft: CaptureDraft, fields = true) {
  if (state) state.draft = draft;
  if (fields) {
    $("note").dataset.loaded = "true";
    $("writing-hint").textContent = "";
    $<HTMLTextAreaElement>("note").value = draft.text;
    $<HTMLSelectElement>("destination").value = draft.projectId ?? "";
  }
  $("source-label").textContent = draft.source
    ? new URL(draft.source.url).hostname
    : "";
  $("destination-name").textContent =
    $<HTMLSelectElement>("destination").selectedOptions[0]?.textContent ??
    "Personal";
  const save = draft.save;
  let changedSinceSave = false;
  if (save?.status === "saved") {
    try {
      changedSinceSave =
        save.request.content !== formatCaptureDraft(draft) ||
        save.request.projectId !== draft.projectId ||
        JSON.stringify(save.request.provenance) !==
          JSON.stringify(draft.source);
    } catch {
      changedSinceSave = true;
    }
  }
  $("save-state").textContent = !save
    ? ""
    : save.status === "saved"
      ? changedSinceSave
        ? "Your earlier note is saved. These changes aren’t saved yet."
        : "Saved."
      : save.status === "failed"
        ? "Couldn’t save. Your note is still here. Retry the earlier note."
        : save.status === "uncertain"
          ? "Save not confirmed. Retry the earlier note safely; newer changes stay here."
          : "Saving…";
  $("save").textContent =
    save && save.status !== "saved" ? "Retry earlier note" : "Save note";
  $<HTMLButtonElement>("save").formNoValidate =
    !!save && save.status !== "saved";
  $<HTMLAnchorElement>("saved-link").hidden = save?.status !== "saved";
  if (save?.status === "saved")
    $<HTMLAnchorElement>("saved-link").href = noteUrl(save.receipt.noteId);
  if (save?.status === "saved" && state) {
    state.pending = state.pending.filter(
      (item) => item.operationId !== save.request.operationId,
    );
    for (const row of [...$("pending-list").children])
      if ((row as HTMLElement).dataset.operationId === save.request.operationId)
        row.remove();
    $("recovery-settings").hidden = !state.pending.length;
  }
  $("share-draft").textContent =
    save?.status === "saved" && !changedSinceSave ? "Share" : "Save & share";
  $<HTMLButtonElement>("share-draft").disabled =
    !!save && save.status !== "saved";
  count();
  if (fields) writingController.refresh();
}
function count() {
  const share = $<HTMLButtonElement>("share-draft");
  share.disabled =
    savingCapture ||
    !state?.identity.capabilities.includes("memory:write") ||
    !state.identity.capabilities.includes("memory:read") ||
    (!!state.draft?.save && state.draft.save.status !== "saved") ||
    (!$<HTMLTextAreaElement>("note").value.trim() && !state.draft?.source);
  $("new-note").hidden =
    !state?.draft || state.draft.sourceMode === "automatic";
  if (!$<HTMLTextAreaElement>("note").value.trim() && !state?.draft?.source) {
    $("length").textContent = "0 / 6,000";
    return;
  }
  try {
    $("length").textContent =
      `${formatCaptureDraft({ ...state?.draft, text: $<HTMLTextAreaElement>("note").value }).length.toLocaleString()} / 6,000`;
  } catch {
    $("length").textContent = "Over the 6,000 character limit";
  }
}
function persist(changes: {
  text?: string;
  projectId?: string | null;
  source?: CaptureDraft["source"] | null;
}) {
  draftRevision++;
  // Keep the source visible at the first keystroke even if a navigation RPC
  // is already in flight. Only an explicit new note resumes source following.
  const pinned = { source: state?.draft?.source ?? null, ...changes };
  editTail = editTail
    .catch(() => {})
    .then(async () => {
      const draft = await rpc<CaptureDraft>("edit", pinned);
      paintDraft(draft, false);
    });
  void editTail.catch(() =>
    notice("Couldn’t keep this draft. Leave it open and try again."),
  );
}
async function followSource() {
  if (
    !preferences.enabled ||
    !approved() ||
    !state?.draft ||
    state.draft.sourceMode !== "automatic" ||
    state.draft.save
  )
    return;
  const revision = draftRevision;
  const epoch = sessionEpoch;
  editTail = editTail
    .catch(() => {})
    .then(async () => {
      if (
        revision !== draftRevision ||
        epoch !== sessionEpoch ||
        !preferences.enabled
      )
        return;
      const draft = await rpc<CaptureDraft>("followSource");
      if (
        revision !== draftRevision ||
        epoch !== sessionEpoch ||
        !preferences.enabled
      )
        return;
      // Only source fields change: never reset the note, caret, destination or scroll.
      if (state) state.draft = draft;
      paintDraft(draft, false);
    });
  await editTail;
}
async function refresh() {
  if (!preferences.enabled) return;
  await editTail;
  const next = await rpc<State>("state");
  const changed =
    state &&
    (next.identity.accountId !== state.identity.accountId ||
      next.identity.connectionId !== state.identity.connectionId);
  if (changed) {
    clearRecall();
  }
  state = next;
  notebookCursor = next.notebooks.nextCursor;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    ".approval-link",
  ))
    link.href = approvalUrl();
  updateNotebooks(next.notebooks.items);
  if (state.draft)
    paintDraft(
      state.draft,
      !$<HTMLTextAreaElement>("note").dataset.loaded || !!changed,
    );
  $<HTMLButtonElement>("save").disabled =
    !state.identity.capabilities.includes("memory:write");
  const pending = $("pending-list");
  pending.replaceChildren();
  for (const item of state.pending) {
    const row = document.createElement("div");
    row.className = "pending-row";
    row.dataset.operationId = item.operationId;
    const label = document.createElement("span");
    label.textContent = `Unconfirmed · ${new Date(item.createdAt).toLocaleDateString()}`;
    const check = document.createElement("button");
    check.textContent = "Check save";
    check.onclick = () => {
      void action(async () => {
        const saved = await rpc<{ noteId: string; version: number }>(
          "reconcile",
          item.operationId,
        );
        label.textContent = "Saved.";
        check.remove();
        const link = document.createElement("a");
        link.href = noteUrl(saved.noteId);
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Open note";
        row.append(link);
      });
    };
    row.append(label, check);
    pending.append(row);
  }
  paintPreferences(preferences);
  await followSource();
  await loadInbox();
  writingPreferences = await rpc<WritingPreferences>("writingState");
  paintWriting();
}
async function loadInbox() {
  const items = await rpc<Inbox[]>("inbox");
  $("inbox").hidden = !items.length;
  const list = $("inbox-list");
  const existing = new Map(
    [...list.children].map((el) => [(el as HTMLElement).dataset.id, el]),
  );
  for (const item of items) {
    if (existing.has(item.id)) {
      existing.delete(item.id);
      continue;
    }
    const row = document.createElement("div");
    row.className = "inbox-row";
    row.dataset.id = item.id;
    const p = document.createElement("p");
    p.textContent = item.text || item.source.title || item.source.url;
    const button = document.createElement("button");
    button.textContent = "Add to note";
    button.onclick = () => {
      void action(async () =>
        replace(async () => {
          await editTail;
          paintDraft(await rpc<CaptureDraft>("takeInbox", item.id));
          await loadInbox();
        }),
      );
    };
    row.append(p, button);
    list.append(row);
  }
  existing.forEach((el) => el.remove());
}
async function replace(run: () => Promise<void>) {
  if (
    state?.draft?.sourceMode !== "automatic" &&
    ($<HTMLTextAreaElement>("note").value || state?.draft?.source)
  ) {
    replaceAction = run;
    $<HTMLDialogElement>("confirm").showModal();
    return;
  }
  await run();
}
function emptyResults() {
  return {
    cursor: null as string | null,
    input: { query: "" },
    items: [] as Memory[],
    status: "Type to search your notes.",
  };
}
let resultState = emptyResults();
function clearRecall() {
  cancelSearch();
  resultState = emptyResults();
  $("results").replaceChildren();
  closeDialogs();
}
function sameNote(previous: Memory | undefined, note: Memory) {
  return (
    previous?.version === note.version &&
    previous.content === note.content &&
    previous.kind === note.kind &&
    previous.updatedAt === note.updatedAt
  );
}
function paintResults() {
  if (!recallView()) return;
  const current = resultState,
    list = $("results");
  $("results-status").textContent = current.status;
  $("results-more").hidden = !current.cursor;
  const existing = new Map(
    [...list.children].map((el) => [
      (el as HTMLElement).dataset.id,
      el as HTMLElement,
    ]),
  );
  current.items.forEach((note, index) => {
    let row = existing.get(note.id);
    if (!row || !sameNote(renderedNotes.get(row), note)) {
      row?.remove();
      row = noteRow(note);
    }
    if (list.children[index] !== row)
      list.insertBefore(row, list.children[index] ?? null);
    existing.delete(note.id);
  });
  existing.forEach((row) => row.remove());
}
function cancelSearch() {
  clearTimeout(searchTimer);
  searchRevision++;
}
function scheduleSearch(immediate = false) {
  cancelSearch();
  if (composingSearch || !preferences.enabled || !approved()) return;
  const revision = searchRevision;
  const query = $<HTMLInputElement>("query").value.trim();
  resultState.cursor = null;
  $("search-retry").hidden = true;
  if (!query) {
    resultState = emptyResults();
    paintResults();
    return;
  }
  resultState.status = resultState.items.length
    ? "Waiting to search… Previous results below."
    : "Waiting to search…";
  paintResults();
  searchTimer = setTimeout(
    () => void find(false, revision),
    immediate ? 0 : 250,
  );
}
async function find(more = false, revision = searchRevision) {
  const epoch = sessionEpoch;
  if (revision !== searchRevision || !preferences.enabled || !approved())
    return;
  const current = resultState;
  const input = more
    ? current.input
    : { query: $<HTMLInputElement>("query").value.trim() };
  if (!input.query) return;
  current.status = "Finding notes…";
  $("search-retry").hidden = true;
  $<HTMLButtonElement>("results-more").disabled = true;
  paintResults();
  const active = () =>
    revision === searchRevision &&
    epoch === sessionEpoch &&
    preferences.enabled;
  try {
    const data = await rpc<{ items: Memory[]; nextCursor: string | null }>(
      "search",
      { ...(input as object), ...(more ? { cursor: current.cursor } : {}) },
    );
    if (!active()) return;
    current.input = input;
    current.cursor = data.nextCursor;
    current.items = [
      ...new Map(
        [...(more ? current.items : []), ...data.items].map((note) => [
          note.id,
          note,
        ]),
      ).values(),
    ];
    current.status = `${current.items.length} ${current.items.length === 1 ? "note" : "notes"}${data.nextCursor ? " · more available" : ""} · checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    if (!active()) return;
    current.status = "Could not refresh. Any previous results below are stale.";
    $("search-retry").hidden = false;
  } finally {
    if (active()) {
      $<HTMLButtonElement>("results-more").disabled = false;
      paintResults();
    }
  }
}
function noteRow(note: Memory) {
  const row = document.createElement("article");
  row.className = "note-row";
  row.dataset.id = note.id;
  renderedNotes.set(row, note);
  const body = document.createElement("div"),
    button = document.createElement("button"),
    preview = document.createElement("div"),
    actions = document.createElement("div"),
    meta = document.createElement("p");
  preview.className = "note-document note-preview";
  preview.append(
    renderNote(note.content.slice(0, 1600), noteUrl(note.id), document, true),
  );
  actions.className = "note-actions";
  actions.setAttribute("role", "menu");
  button.textContent = "Open";
  button.className = "quiet open-note";
  button.onclick = () => {
    const revision = ++readerRevision;
    void action(async () => {
      button.setAttribute("aria-busy", "true");
      try {
        const current = await rpc<Memory>("read", note.id);
        if (revision !== readerRevision) return;
        readerNote = current;
        $("reader-content").replaceChildren(
          renderNote(current.content, noteUrl(current.id)),
        );
        $("reader-copy-state").textContent = "";
        $("reader-meta").textContent =
          `Updated ${new Date(current.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
        $<HTMLAnchorElement>("reader-link").href = noteUrl(note.id);
        $<HTMLDialogElement>("reader").showModal();
      } finally {
        button.removeAttribute("aria-busy");
      }
    });
  };
  meta.textContent = new Date(note.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const copy = document.createElement("button"),
    share = document.createElement("button"),
    feedback = document.createElement("p");
  copy.textContent = "Copy";
  copy.className = "quiet";
  copy.onclick = () => {
    void action(async () => {
      const current = await rpc<Memory>("read", note.id);
      if (current.version !== note.version) {
        feedback.textContent = "Note changed. Refresh to copy.";
        return;
      }
      feedback.textContent = (await copyText(current.content))
        ? "Copied."
        : "Couldn’t copy. Open the note to try again.";
    });
  };
  share.textContent = "Share";
  share.className = "quiet";
  share.onclick = () => {
    void sharing.open(note.id);
  };
  feedback.className = "row-feedback";
  feedback.setAttribute("role", "status");
  actions.append(button, copy, share);
  const menu = document.createElement("details"),
    trigger = document.createElement("summary"),
    footer = document.createElement("div");
  menu.className = "note-menu";
  trigger.textContent = "•••";
  trigger.setAttribute("role", "button");
  trigger.setAttribute("aria-label", "Note actions");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  for (const action of [button, copy, share]) {
    action.setAttribute("role", "menuitem");
    action.addEventListener(
      "click",
      () => {
        menu.open = false;
        trigger.focus({ preventScroll: true });
      },
      { capture: true },
    );
  }
  menu.append(trigger, actions);
  menu.addEventListener("toggle", () => {
    trigger.setAttribute("aria-expanded", String(menu.open));
    if (!menu.open) return;
    document
      .querySelectorAll<HTMLDetailsElement>(".note-menu[open]")
      .forEach((other) => {
        if (other !== menu) other.open = false;
      });
    const rect = trigger.getBoundingClientRect();
    actions.style.top = rect.top < actions.offsetHeight + 16 ? "100%" : "auto";
    actions.style.bottom =
      rect.top < actions.offsetHeight + 16 ? "auto" : "100%";
  });
  menu.addEventListener("keydown", (event) => {
    const items = [button, copy, share];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      menu.open = false;
      trigger.focus({ preventScroll: true });
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      menu.open = true;
      items[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 2
            : index < 0
              ? event.key === "ArrowUp"
                ? 2
                : 0
              : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
                items.length
      ].focus({ preventScroll: true });
    }
  });
  menu.addEventListener("focusout", (event) => {
    if (!menu.contains(event.relatedTarget as Node | null)) menu.open = false;
  });
  footer.className = "note-footer";
  footer.append(meta, menu);
  body.append(preview, footer, feedback);
  row.append(body);
  return row;
}
document
  .querySelectorAll<HTMLElement>("[data-nav]")
  .forEach((el) => el.addEventListener("click", () => show(el.dataset.nav!)));
document.addEventListener("pointerdown", (event) => {
  document
    .querySelectorAll<HTMLDetailsElement>(".note-menu[open]")
    .forEach((menu) => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
});
on("dismiss-notice", async () => notice());
$("capture-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(saveCapture);
});
async function saveCapture() {
  if (savingCapture) throw new Error("Wait for the save to finish.");
  savingCapture = true;
  $<HTMLButtonElement>("share-draft").disabled = true;
  try {
    await editTail;
    if (!state?.draft?.save || state.draft.save.status === "saved") {
      paintDraft(
        await rpc<CaptureDraft>("edit", {
          text: $<HTMLTextAreaElement>("note").value,
          projectId: $<HTMLSelectElement>("destination").value || null,
        }),
        false,
      );
    }
    const button = $<HTMLButtonElement>("save");
    button.disabled = true;
    $("save-state").textContent = "Saving…";
    try {
      const result = await rpc<{ draft: CaptureDraft }>("save");
      paintDraft(result.draft, false);
    } catch (error) {
      try {
        await refresh();
      } catch {
        /* Preserve the mounted draft even when reconnection fails. */
      }
      throw error;
    } finally {
      button.disabled = !state?.identity.capabilities.includes("memory:write");
    }
  } finally {
    savingCapture = false;
    if (state?.draft) paintDraft(state.draft, false);
  }
}
on("share-draft", async () => {
  await editTail;
  if (state?.draft?.save && state.draft.save.status !== "saved") {
    notice("Check the earlier save before sharing.");
    return;
  }
  await saveCapture();
  const draft = state?.draft;
  if (
    draft?.save?.status !== "saved" ||
    draft.save.request.content !==
      formatCaptureDraft({
        ...draft,
        text: $<HTMLTextAreaElement>("note").value,
      }) ||
    draft.save.request.projectId !==
      ($<HTMLSelectElement>("destination").value || null)
  ) {
    notice("Save your changes before sharing.");
    return;
  }
  await sharing.open(draft.save.receipt.noteId);
});
$("note").addEventListener("input", () => {
  $("writing-hint").textContent = "";
  count();
  persist({ text: $<HTMLTextAreaElement>("note").value });
});
$("destination").addEventListener("change", () =>
  persist({ projectId: $<HTMLSelectElement>("destination").value || null }),
);
on("new-note", async () =>
  replace(async () => {
    await editTail;
    paintDraft(await rpc<CaptureDraft>("clear"));
    draftRevision++;
    await followSource();
  }),
);
on("cancel-replace", async () => {
  $<HTMLDialogElement>("confirm").close();
  replaceAction = undefined;
});
on("confirm-replace", async () => {
  const run = replaceAction;
  replaceAction = undefined;
  $<HTMLDialogElement>("confirm").close();
  await run?.();
});
$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!composingSearch) scheduleSearch(true);
});
$("query").addEventListener("input", () => scheduleSearch());
$("query").addEventListener("compositionstart", () => {
  composingSearch = true;
  cancelSearch();
});
$("query").addEventListener("compositionend", () => {
  composingSearch = false;
  scheduleSearch();
});
on("search-retry", async () => scheduleSearch(true));
on("results-more", () => find(true));
on("close-reader", async () => {
  $<HTMLDialogElement>("reader").close();
});
$("reader").addEventListener("close", () => {
  readerNote = undefined;
  readerRevision++;
});
on("copy-note", async () => {
  if (!readerNote) return;
  const note = readerNote;
  const current = await rpc<Memory>("read", note.id);
  if (current.version !== note.version || readerNote?.id !== note.id)
    throw new Error("This note changed. Reopen it before copying.");
  $("reader-copy-state").textContent = (await copyText(current.content))
    ? "Copied. Ready to paste."
    : "Could not copy. Open in Grove to copy this note.";
});
on("share-reader", async () => {
  if (readerNote) await sharing.open(readerNote.id);
});
on("login", async () => {
  const button = $<HTMLButtonElement>("login");
  button.disabled = true;
  try {
    await rpc("login");
    await refresh();
  } finally {
    button.disabled = false;
  }
});
on("refresh", refresh);
on("approved", refresh);
on("notebooks-more", async () => {
  const page = await rpc<State["notebooks"]>("notebooks", notebookCursor);
  notebookCursor = page.nextCursor;
  updateNotebooks(page.items, true);
});
function clearSessionView() {
  sessionEpoch++;
  view = "capture";
  state = undefined;
  if (writingPreferences)
    writingPreferences = {
      ...writingPreferences,
      settings: { ...writingPreferences.settings, words: [] },
    };
  const epoch = sessionEpoch;
  void rpc<WritingPreferences>("writingState")
    .then((next) => {
      if (
        epoch !== sessionEpoch ||
        (writingPreferences && next.version < writingPreferences.version)
      )
        return;
      writingPreferences = next;
      paintWriting();
    })
    .catch(() => {
      $("writing-settings-status").textContent =
        "Writing settings couldn’t refresh.";
    });
  paintWriting();
  readerNote = undefined;
  readerRevision++;
  clearRecall();
  $<HTMLTextAreaElement>("note").value = "";
  delete $("note").dataset.loaded;
  $("inbox-list").replaceChildren();
  $("pending-list").replaceChildren();
  for (const id of ["query"]) $<HTMLInputElement>(id).value = "";
  $("reader-content").textContent = "";
  $("reader-meta").textContent = "";
  $("save-state").textContent = "";
  $("search-retry").hidden = true;
  $("saved-link").hidden = true;
  $("inbox").hidden = true;
  $("connection-state").textContent = "";
  paintPreferences(preferences);
}
on("logout", async () => {
  await editTail;
  await rpc("logout");
  clearSessionView();
});
host.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes[writingBrowserKey] ||
      Object.keys(changes).some((key) => key.startsWith("writing-words:")))
  ) {
    void action(async () => {
      writingPreferences = await rpc<WritingPreferences>("writingState");
      paintWriting();
    });
  }
  if (area === "local" && changes.preferences?.newValue) {
    const wasEnabled = preferences.enabled;
    paintPreferences(changes.preferences.newValue as Preferences);
    if (!wasEnabled && preferences.enabled && !configuring)
      void action(connectView);
    return;
  }
  if (area !== "session") return;
  const identity = changes.identity?.newValue as State["identity"] | undefined;
  if (
    changes.identity &&
    state &&
    (!identity ||
      identity.accountId !== state.identity.accountId ||
      identity.connectionId !== state.identity.connectionId)
  ) {
    clearSessionView();
    if (identity) void action(refresh);
    return;
  }
  if (changes[`inbox:${windowId}`] && state && preferences.enabled)
    void action(loadInbox);
  if (changes.identity && identity && state) {
    state.identity.writingTools = identity.writingTools;
    writingController.refreshTools();
  }
  const entry = changes[`entryError:${windowId}`];
  if (entry?.newValue) notice("Couldn’t prepare that note. Try again.");
});
host.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId)
    void followSource().catch(() => notice("Couldn’t update page details."));
});
host.tabs.onUpdated.addListener((_id, changes, tab) => {
  if (
    tab.windowId === windowId &&
    tab.active &&
    (changes.url !== undefined ||
      changes.title !== undefined ||
      changes.status === "complete")
  )
    void followSource().catch(() => notice("Couldn’t update page details."));
});
$<HTMLAnchorElement>("home").href = extensionConfig.siteOrigin;
on("extension-toggle", () => configure({ enabled: !preferences.enabled }));
const ruleNames: Record<(typeof writingRules)[number], string> = {
  brackets: "Matching brackets",
  quotes: "Matching quotes",
  articles: "A or an",
  repetition: "Repeated words",
  spacing: "Spacing and punctuation",
  capitalization: "Capitalization",
  redundancy: "Wordy phrases",
  agreement: "Verb agreement",
  plurals: "Acronym plurals",
  confusion: "Confused words",
};
function writingControlId(key: string) {
  return `writing-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
for (const rule of writingRules) {
  const label = document.createElement("label");
  label.className = "writing-option";
  const name = document.createElement("span");
  name.textContent = ruleNames[rule];
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `writing-rule-${rule}`;
  input.setAttribute("role", "switch");
  input.addEventListener("change", () => {
    void action(() =>
      saveWriting({ patch: { rules: { [rule]: input.checked } } }),
    );
  });
  label.append(name, input);
  $("writing-rules").append(label);
}
for (const key of [
  "enabled",
  "spelling",
  "grammar",
  "aiRewrites",
  "automatic",
  "highlights",
] as const)
  $(writingControlId(key)).addEventListener("change", () => {
    void action(() =>
      saveWriting({
        patch: { [key]: $<HTMLInputElement>(writingControlId(key)).checked },
      }),
    );
  });
$("writing-word-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    const input = $<HTMLInputElement>("writing-word");
    const word = input.value.trim();
    await saveWriting({ addWord: word });
    if (input.value.trim() === word) input.value = "";
  });
});
on("writing-words-more", async () => {
  visibleWords += 20;
  paintWriting();
});
on("writing-review", async () => {
  await writingController.check();
  writingController.review();
});
on("writing-enable-site", async () => {
  const [tab] = await host.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.incognito !== false || tab.id === undefined)
    throw new Error("Open Grove beside an ordinary website.");
  const url = new URL(tab.url);
  if (
    url.username ||
    url.password ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new Error("This page does not support writing checks.");
  $<HTMLInputElement>("writing-domain").value = url.hostname.replace(/\.$/, "");
  $<HTMLInputElement>("writing-domain").focus();
});
$("writing-domain-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    const input = $<HTMLInputElement>("writing-domain"),
      domain = input.value;
    await saveWriting({ site: { domain, enabled: false } });
    if (input.value === domain) input.value = "";
  });
});
paintWriting();
$("theme").addEventListener("change", () => {
  void action(() =>
    configure({
      theme: $<HTMLSelectElement>("theme").value as Preferences["theme"],
    }),
  );
});
async function paintGrace() {
  const note = document.querySelector<HTMLElement>("#grace-note");
  if (!note || state) {
    if (note) note.hidden = true;
    return;
  }
  try {
    const grace = await rpc<{
      state: "active" | "expired";
      daysLeft: number;
    }>("grace");
    note.hidden = false;
    note.textContent =
      grace.state === "expired"
        ? "Your free start has ended. Create a free Grove account to keep saving and searching notes. Spelling and grammar checks keep working on this device."
        : `No account needed to start: spelling and grammar checks work now. Create a free account within ${grace.daysLeft} ${grace.daysLeft === 1 ? "day" : "days"} to keep saving and searching notes.`;
  } catch {
    // Anonymous grace is advisory only; local checks never depend on it.
    note.hidden = true;
  }
}
async function connectView() {
  writingPreferences = await rpc<WritingPreferences>("writingState");
  paintWriting();
  try {
    await refresh();
    if (resultState.status.startsWith("Search paused")) scheduleSearch(true);
  } catch (error) {
    if (!state) {
      show(view);
      await paintGrace();
      notice(userMessage(error, "Sign in to connect Grove."));
    } else throw error;
  }
  if (!state) await paintGrace();
}
void action(async () => {
  const window = await host.windows.getCurrent();
  if (window.id === undefined) throw new Error("Browser window unavailable");
  windowId = window.id;
  paintPreferences(await rpc<Preferences>("preferences"));
  $<HTMLButtonElement>("extension-toggle").disabled = false;
  if (preferences.enabled) await connectView();
  const key = `entryError:${windowId}`;
  const [entry, globalEntry] = await Promise.all([
    host.storage.session.get(key),
    host.storage.session.get("entryError:0"),
  ]);
  const error = entry[key] ?? globalEntry["entryError:0"];
  if (typeof error === "string") {
    notice("Couldn’t prepare that note. Try again.");
    await host.storage.session.remove(
      entry[key] !== undefined ? key : "entryError:0",
    );
  }
});
