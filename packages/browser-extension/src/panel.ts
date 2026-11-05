import type { Memory } from "@lib/shared/contracts";
import {
  normalizeWebUrl,
  webCaptureSchema,
  formatWebCapture,
} from "@lib/shared/web-capture";
import type { CaptureDraft } from "./drafts.ts";
import type { ExtensionClient } from "./client.ts";
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
let notebookCursor: string | null = null;
const selected = new Map<string, { id: string; version: number }>();
let preparedContext:
  | { text: string; items: { id: string; version: number }[] }
  | undefined;
let editTail: Promise<unknown> = Promise.resolve(),
  replaceAction: (() => Promise<void>) | undefined;
const selections = () => [...selected.values()];
function notice(message = "") {
  $("notice").textContent = message;
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
  if (epoch !== sessionEpoch && kind !== "logout")
    throw new Error("Connection changed. Reopen Grove before continuing.");
  if (
    scope &&
    !["state", "login", "logout"].includes(kind) &&
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
  view = next;
  document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((el) => (el.hidden = el.dataset.view !== next));
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    if (el.dataset.nav === next) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
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
    : "optional";
  const save = draft.save;
  let changedSinceSave = false;
  if (save?.status === "saved") {
    try {
      changedSinceSave =
        save.request.content !== formatWebCapture(draft) ||
        save.request.projectId !== draft.projectId ||
        JSON.stringify(save.request.provenance) !==
          JSON.stringify(draft.source);
    } catch {
      changedSinceSave = true;
    }
  }
  $("save-state").textContent = !save
    ? "Draft stays in this browser session."
    : save.status === "saved"
      ? `${changedSinceSave ? "Previous note saved. Newer draft is not saved." : "Saved in Grove."} Version ${save.receipt.version}. Search indexing: ${save.receipt.indexing}.`
      : save.status === "failed"
        ? "Save was rejected. Your draft is kept; retry repeats the reviewed request."
        : save.status === "uncertain"
          ? "Save outcome is unknown. Retry safely repeats the same request; newer edits stay in your draft."
          : "Saving the reviewed note…";
  $("save").textContent =
    save && save.status !== "saved" ? "Retry original save" : "Save note";
  $<HTMLButtonElement>("save").formNoValidate =
    !!save && save.status !== "saved";
  $<HTMLAnchorElement>("saved-link").hidden = save?.status !== "saved";
  if (save?.status === "saved")
    $<HTMLAnchorElement>("saved-link").href = noteUrl(save.receipt.noteId);
  count();
}
function count() {
  if (!$<HTMLTextAreaElement>("note").value.trim() && !state?.draft?.source) {
    $("length").textContent = "0 / 6,000";
    return;
  }
  try {
    $("length").textContent =
      `${formatWebCapture({ text: $<HTMLTextAreaElement>("note").value, ...(state?.draft?.source ? { source: state.draft.source } : {}) }).length.toLocaleString()} / 6,000`;
  } catch {
    $("length").textContent = "Over the 6,000 character limit";
  }
}
function persist(changes: {
  text?: string;
  projectId?: string | null;
  source?: CaptureDraft["source"] | null;
}) {
  editTail = editTail
    .catch(() => {})
    .then(async () => {
      const draft = await rpc<CaptureDraft>("edit", changes);
      paintDraft(draft, false);
    });
  void editTail.catch((error) =>
    notice(`Draft was not stored: ${error.message}`),
  );
}
async function refresh() {
  await editTail;
  const next = await rpc<State>("state");
  const changed =
    state &&
    (next.identity.accountId !== state.identity.accountId ||
      next.identity.connectionId !== state.identity.connectionId);
  if (changed) {
    selected.clear();
    $("search-results").replaceChildren();
    $("page-results").replaceChildren();
    for (const dialog of document.querySelectorAll("dialog")) dialog.close();
  }
  state = next;
  notebookCursor = next.notebooks.nextCursor;
  $("welcome").hidden = true;
  const approved = state.identity.capabilities.some((cap) =>
    ["memory:read", "memory:write"].includes(cap),
  );
  $("approval").hidden = approved;
  $("workspace").hidden = !approved;
  $("navigation").hidden = !approved;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    ".approval-link",
  ))
    link.href = approvalUrl();
  $("connection-label").textContent = "Connected to Grove";
  updateNotebooks(next.notebooks.items);
  if (state.draft)
    paintDraft(
      state.draft,
      !$<HTMLTextAreaElement>("note").dataset.loaded || !!changed,
    );
  $<HTMLButtonElement>("save").disabled =
    !state.identity.capabilities.includes("memory:write");
  $("api-origin").textContent = extensionConfig.apiOrigin;
  $("account-id").textContent = state.identity.accountId;
  $("capabilities").textContent =
    state.identity.capabilities.join(", ") || "Awaiting approval";
  const pending = $("pending-list");
  pending.replaceChildren();
  for (const item of state.pending) {
    const row = document.createElement("div");
    row.className = "pending-row";
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
  show(view);
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
    button.textContent = "Review capture";
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
    $<HTMLTextAreaElement>("note").value ||
    $<HTMLInputElement>("source-url").value
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
const resultState = {
  search: { cursor: null as string | null, input: {} as unknown },
  page: { cursor: null as string | null, input: {} as unknown },
};
async function find(kind: "search" | "page", more = false) {
  await editTail;
  const current = resultState[kind];
  const input = more
    ? current.input
    : kind === "search"
      ? {
          query: $<HTMLInputElement>("query").value,
          projectId: $<HTMLSelectElement>("search-scope").value || null,
        }
      : {
          url: normalizeWebUrl($<HTMLInputElement>("page-url").value),
          projectId: $<HTMLSelectElement>("page-scope").value || null,
        };
  const status = $(`${kind}-status`);
  status.textContent =
    "Finding notes… Existing results are kept until this search completes.";
  try {
    const data = await rpc<{ items: Memory[]; nextCursor: string | null }>(
      kind === "page" ? "pages" : "search",
      { ...(input as object), ...(more ? { cursor: current.cursor } : {}) },
    );
    current.input = input;
    current.cursor = data.nextCursor;
    const list = $(`${kind}-results`);
    if (!more) {
      list.replaceChildren();
    }
    for (const note of data.items) appendNote(list, note);
    status.textContent = `${list.childElementCount} notes shown${data.nextCursor ? " · more available" : ""} · checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    $(`${kind}-more`).hidden = !data.nextCursor;
  } catch (error) {
    status.textContent =
      "Could not refresh. Any previous results below are stale.";
    throw error;
  }
}
function appendNote(list: HTMLElement, note: Memory) {
  if (
    [...list.children].some((el) => (el as HTMLElement).dataset.id === note.id)
  )
    return;
  const row = document.createElement("article");
  row.className = "note-row";
  row.dataset.id = note.id;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(note.id);
  checkbox.setAttribute(
    "aria-label",
    `Select note for context: ${note.content.slice(0, 70)}`,
  );
  checkbox.onchange = () => {
    if (checkbox.checked) {
      if (selected.size >= 6) {
        checkbox.checked = false;
        notice("Choose at most six notes for context.");
        return;
      }
      selected.set(note.id, { id: note.id, version: note.version });
    } else selected.delete(note.id);
    $("review-context").textContent = `Review context (${selected.size})`;
  };
  const body = document.createElement("div"),
    button = document.createElement("button"),
    excerpt = document.createElement("span"),
    meta = document.createElement("p");
  excerpt.className = "excerpt";
  excerpt.textContent = note.content;
  button.append(excerpt);
  button.onclick = () => {
    void action(async () => {
      const current = await rpc<Memory>("read", note.id);
      $("reader-content").textContent = current.content;
      $("reader-meta").textContent =
        `Version ${current.version} · ${current.kind}`;
      $<HTMLAnchorElement>("reader-link").href = noteUrl(note.id);
      $<HTMLDialogElement>("reader").showModal();
    });
  };
  meta.textContent = `${note.kind} · version ${note.version} · ${new Date(note.updatedAt).toLocaleDateString()}`;
  body.append(button, meta);
  row.append(checkbox, body);
  list.append(row);
}
document
  .querySelectorAll<HTMLElement>("[data-nav]")
  .forEach((el) => el.addEventListener("click", () => show(el.dataset.nav!)));
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
    $("save-state").textContent = "Saving the reviewed note…";
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
  $(id).addEventListener("change", () => {
    try {
      persist({ source: source() });
    } catch (error) {
      notice(error instanceof Error ? error.message : "Invalid source link");
    }
  });
on("attach", async () => {
  const capture = await rpc<CaptureDraft["source"]>("attach");
  paintDraft(await rpc<CaptureDraft>("edit", { source: capture }), false);
  $<HTMLInputElement>("source-url").value = capture!.url;
  $<HTMLInputElement>("source-title").value = capture!.title;
});
on("remove-source", async () => {
  await editTail;
  paintDraft(await rpc<CaptureDraft>("edit", { source: null }), false);
  $<HTMLInputElement>("source-url").value = "";
  $<HTMLInputElement>("source-title").value = "";
});
on("new-note", async () =>
  replace(async () => {
    await editTail;
    paintDraft(await rpc<CaptureDraft>("clear"));
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
for (const kind of ["search", "page"] as const) {
  $(`${kind}-form`).addEventListener("submit", (event) => {
    event.preventDefault();
    void action(() => find(kind));
  });
  on(`${kind}-more`, () => find(kind, true));
}
on("page-current", async () => {
  const capture = await rpc<{ url: string }>("attach");
  $<HTMLInputElement>("page-url").value = capture.url;
});
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
    throw new Error("Context changed. Close and review it again.");
  try {
    await navigator.clipboard.writeText(fresh.text);
    $("copy-state").textContent = "Copied reviewed context.";
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
  state = undefined;
  selected.clear();
  preparedContext = undefined;
  for (const dialog of document.querySelectorAll("dialog")) dialog.close();
  $("workspace").hidden = true;
  $("approval").hidden = true;
  $("navigation").hidden = true;
  $("welcome").hidden = false;
  $("connection-label").textContent = "Private notes";
  $<HTMLTextAreaElement>("note").value = "";
  delete $("note").dataset.loaded;
  $("search-results").replaceChildren();
  $("page-results").replaceChildren();
  $("inbox-list").replaceChildren();
  $("pending-list").replaceChildren();
  for (const id of [
    "source-url",
    "source-title",
    "query",
    "page-url",
    "context-text",
  ])
    $<HTMLInputElement>(id).value = "";
  $("reader-content").textContent = "";
  $("reader-meta").textContent = "";
  $("save-state").textContent = "";
  $("review-context").textContent = "Review context (0)";
  $("saved-link").hidden = true;
  $("inbox").hidden = true;
}
on("logout", async () => {
  await editTail;
  await rpc("logout");
  clearSessionView();
});
host.storage.onChanged.addListener((changes, area) => {
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
  if (changes[`inbox:${windowId}`] && state) void action(loadInbox);
  const entry = changes[`entryError:${windowId}`];
  if (entry?.newValue) notice(String(entry.newValue));
});
$<HTMLAnchorElement>("home").href = extensionConfig.siteOrigin;
void action(async () => {
  const window = await host.windows.getCurrent();
  if (window.id === undefined) throw new Error("Browser window unavailable");
  windowId = window.id;
  try {
    await refresh();
  } catch (error) {
    if (!state) {
      $("welcome").hidden = false;
      notice(
        error instanceof Error ? error.message : "Sign in to connect Grove.",
      );
    } else throw error;
  }
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
