import type { Memory } from "@lib/shared/contracts";
import { webCaptureSchema } from "@lib/shared/web-capture";
import type { CaptureDraft } from "./drafts.ts";
import { formatCaptureDraft } from "./drafts.ts";
import type { ExtensionClient } from "./client.ts";
import { renderNote, noteSummary } from "./reader.ts";
import { nativeBrowser as host, extensionConfig } from "./webextension.ts";

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
let searchRevision = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let composingSearch = false;
let draftRevision = 0;
let readerNote: Memory | undefined;
let readerRevision = 0;
let notebookCursor: string | null = null;
const selected = new Map<string, { id: string; version: number }>();
const renderedNotes = new WeakMap<HTMLElement, Memory>();
const scrollPositions = new Map<string, number>();
let preparedContext:
  | { text: string; items: { id: string; version: number }[] }
  | undefined;
let editTail: Promise<unknown> = Promise.resolve(),
  replaceAction: (() => Promise<void>) | undefined;
const selections = () => [...selected.values()];
const approved = () =>
  state?.identity.capabilities.some((cap) =>
    ["memory:read", "memory:write"].includes(cap),
  ) ?? false;
const recallView = () => view === "search";
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
    throw new Error(
      result?.error?.message ??
        "Grove is unavailable. Reopen the panel and try again.",
    );
  if (
    epoch !== sessionEpoch &&
    !["logout", "configure", "preferences"].includes(kind)
  )
    throw new Error("Connection changed. Reopen Grove before continuing.");
  if (
    scope &&
    !["state", "login", "logout", "configure", "preferences"].includes(kind) &&
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
    notice(error instanceof Error ? error.message : "Grove is unavailable.");
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
      ? "Paused · sign-in retained"
      : approved()
        ? "Connected to Grove"
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
    preparedContext = undefined;
    closeDialogs();
  }
  show(view);
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
    $<HTMLTextAreaElement>("note").value = draft.text;
    $<HTMLSelectElement>("destination").value = draft.projectId ?? "";
    $<HTMLInputElement>("source-url").value = draft.source?.url ?? "";
    $<HTMLInputElement>("source-title").value = draft.source?.title ?? "";
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
  $("save-details").hidden = save?.status !== "saved";
  $("save-version").textContent =
    save?.status === "saved" ? String(save.receipt.version) : "";
  $("save-indexing").textContent =
    save?.status === "saved" ? save.receipt.indexing : "";
  count();
}
function count() {
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
  // is already in flight. Manual source inputs are committed separately.
  const pinned = { source: state?.draft?.source ?? null, ...changes };
  editTail = editTail
    .catch(() => {})
    .then(async () => {
      const draft = await rpc<CaptureDraft>("edit", pinned);
      paintDraft(draft, false);
    });
  void editTail.catch((error) =>
    notice(`Draft was not stored: ${error.message}`),
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
      $<HTMLInputElement>("source-url").value = draft.source?.url ?? "";
      $<HTMLInputElement>("source-title").value = draft.source?.title ?? "";
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
  $("account-id").textContent = state.identity.accountId;
  $("capabilities").textContent =
    state.identity.capabilities
      .map(
        (cap) =>
          (
            ({
              "memory:read": "Read notes",
              "memory:write": "Save notes",
              "memory:delete": "Delete notes",
            }) as Record<string, string>
          )[cap] ?? cap,
      )
      .join(" · ") || "Awaiting approval";
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
        label.textContent = `Saved · version ${saved.version}`;
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
    ($<HTMLTextAreaElement>("note").value ||
      $<HTMLInputElement>("source-url").value)
  ) {
    replaceAction = run;
    $<HTMLDialogElement>("confirm").showModal();
    return;
  }
  await run();
}
function source() {
  const url = $<HTMLInputElement>("source-url").value.trim();
  return url
    ? webCaptureSchema.parse({
        url,
        title: $<HTMLInputElement>("source-title").value,
        capturedAt:
          state?.draft?.source?.capturedAt ?? new Date().toISOString(),
      })
    : null;
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
  selected.clear();
  preparedContext = undefined;
  resultState = emptyResults();
  $("results").replaceChildren();
  updateContextAction();
  closeDialogs();
}
function updateContextAction() {
  $("context-actions").hidden = !selected.size;
  if (recallView())
    $("results-status").textContent = selected.size
      ? `${selected.size} selected${resultState.status.includes("stale") ? " · stale results" : ""}`
      : resultState.status;
  $("review-context").textContent =
    `Copy ${selected.size === 1 ? "note" : `${selected.size} notes`}`;
  document.querySelectorAll<HTMLElement>(".note-row").forEach((row) => {
    row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked =
      selected.has(row.dataset.id!);
  });
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
  updateContextAction();
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
    selected.clear();
    preparedContext = undefined;
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
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(note.id);
  checkbox.setAttribute(
    "aria-label",
    `Select note to copy: ${note.content.slice(0, 70)}`,
  );
  checkbox.onchange = () => {
    if (checkbox.checked) {
      if (selected.size >= 6) {
        checkbox.checked = false;
        notice("Choose up to six notes to copy together.");
        return;
      }
      selected.set(note.id, { id: note.id, version: note.version });
    } else selected.delete(note.id);
    updateContextAction();
  };
  const body = document.createElement("div"),
    button = document.createElement("button"),
    title = document.createElement("span"),
    excerpt = document.createElement("span"),
    meta = document.createElement("p");
  const summary = noteSummary(note.content);
  title.className = "note-title";
  title.textContent = summary.title;
  excerpt.className = "excerpt";
  excerpt.textContent = summary.excerpt;
  excerpt.hidden = !summary.excerpt;
  button.append(title, excerpt);
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
  body.append(button, meta);
  row.append(checkbox, body);
  return row;
}
document
  .querySelectorAll<HTMLElement>("[data-nav]")
  .forEach((el) => el.addEventListener("click", () => show(el.dataset.nav!)));
on("clear-selection", async () => {
  selected.clear();
  updateContextAction();
  $<HTMLInputElement>("query").focus();
});
on("dismiss-notice", async () => notice());
$("capture-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(async () => {
    await editTail;
    if (!state?.draft?.save || state.draft.save.status === "saved") {
      const sourceValue = source();
      paintDraft(
        await rpc<CaptureDraft>("edit", {
          text: $<HTMLTextAreaElement>("note").value,
          projectId: $<HTMLSelectElement>("destination").value || null,
          source: sourceValue,
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
  });
});
$("note").addEventListener("input", () => {
  count();
  persist({ text: $<HTMLTextAreaElement>("note").value });
});
$("destination").addEventListener("change", () =>
  persist({ projectId: $<HTMLSelectElement>("destination").value || null }),
);
for (const id of ["source-url", "source-title"])
  $(id).addEventListener("input", () => {
    // Fence autofill immediately, before change/blur (including invalid drafts).
    draftRevision++;
    if (state?.draft) state.draft.sourceMode = "pinned";
    try {
      persist({ source: source() });
    } catch {
      // Keep invalid intermediate text mounted; still persist the ownership pin.
      persist({});
    }
  });
on("attach", async () => {
  draftRevision++;
  await editTail;
  const capture = await rpc<CaptureDraft["source"]>("attach");
  paintDraft(await rpc<CaptureDraft>("edit", { source: capture }), false);
  $<HTMLInputElement>("source-url").value = capture!.url;
  $<HTMLInputElement>("source-title").value = capture!.title;
});
on("remove-source", async () => {
  draftRevision++;
  await editTail;
  paintDraft(await rpc<CaptureDraft>("edit", { source: null }), false);
  $<HTMLInputElement>("source-url").value = "";
  $<HTMLInputElement>("source-title").value = "";
});
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
on("review-context", async () => {
  preparedContext = await rpc("context", selections());
  $<HTMLTextAreaElement>("context-text").value = preparedContext!.text;
  $<HTMLInputElement>("copy-consent").checked = false;
  $<HTMLButtonElement>("copy").disabled = true;
  $("copy-state").textContent = "";
  $<HTMLDialogElement>("context").showModal();
});
$("copy-consent").addEventListener("change", () => {
  $<HTMLButtonElement>("copy").disabled =
    !$<HTMLInputElement>("copy-consent").checked;
});
on("copy", async () => {
  if (!preparedContext || !$<HTMLInputElement>("copy-consent").checked) return;
  const fresh = await rpc<typeof preparedContext>(
    "context",
    preparedContext.items,
  );
  if (fresh.text !== preparedContext.text)
    throw new Error(
      "A selected note changed. Close this and check the notes again.",
    );
  try {
    await navigator.clipboard.writeText(fresh.text);
    $("copy-state").textContent = "Copied. Ready to paste.";
  } catch {
    $("copy-state").textContent =
      "Clipboard unavailable. Select the reviewed text above and copy it manually.";
    $<HTMLTextAreaElement>("context-text").focus();
    $<HTMLTextAreaElement>("context-text").select();
  }
});
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
  try {
    await navigator.clipboard.writeText(current.content);
    $("reader-copy-state").textContent = "Copied. Ready to paste.";
  } catch {
    $("reader-copy-state").textContent =
      "Could not copy. Open in Grove to copy this note.";
  }
});
on("close-context", async () => {
  $<HTMLDialogElement>("context").close();
  preparedContext = undefined;
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
  readerNote = undefined;
  readerRevision++;
  clearRecall();
  $<HTMLTextAreaElement>("note").value = "";
  delete $("note").dataset.loaded;
  $("inbox-list").replaceChildren();
  $("pending-list").replaceChildren();
  for (const id of ["source-url", "source-title", "query", "context-text"])
    $<HTMLInputElement>(id).value = "";
  $("reader-content").textContent = "";
  $("reader-meta").textContent = "";
  $("save-state").textContent = "";
  $("search-retry").hidden = true;
  $("save-details").hidden = true;
  $("saved-link").hidden = true;
  $("inbox").hidden = true;
  $("account-id").textContent = "";
  $("connection-state").textContent = "";
  $("capabilities").textContent = "";
  paintPreferences(preferences);
}
on("logout", async () => {
  await editTail;
  await rpc("logout");
  clearSessionView();
});
host.storage.onChanged.addListener((changes, area) => {
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
  const entry = changes[`entryError:${windowId}`];
  if (entry?.newValue) notice(String(entry.newValue));
});
host.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId)
    void followSource().catch((error) => notice(error.message));
});
host.tabs.onUpdated.addListener((_id, changes, tab) => {
  if (
    tab.windowId === windowId &&
    tab.active &&
    (changes.url !== undefined ||
      changes.title !== undefined ||
      changes.status === "complete")
  )
    void followSource().catch((error) => notice(error.message));
});
$<HTMLAnchorElement>("home").href = extensionConfig.siteOrigin;
$("api-origin").textContent = extensionConfig.apiOrigin;
$("browser-panel").textContent =
  extensionConfig.target === "firefox"
    ? "Firefox sidebar · Alt+Shift+G"
    : `${extensionConfig.target === "edge" ? "Edge" : "Chrome"} side panel · Alt+Shift+G`;
on("extension-toggle", () => configure({ enabled: !preferences.enabled }));
$("theme").addEventListener("change", () => {
  void action(() =>
    configure({
      theme: $<HTMLSelectElement>("theme").value as Preferences["theme"],
    }),
  );
});
async function connectView() {
  try {
    await refresh();
    if (resultState.status.startsWith("Search paused")) scheduleSearch(true);
  } catch (error) {
    if (!state) {
      show(view);
      notice(
        error instanceof Error ? error.message : "Sign in to connect Grove.",
      );
    } else throw error;
  }
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
    notice(error);
    await host.storage.session.remove(
      entry[key] !== undefined ? key : "entryError:0",
    );
  }
});
