import type { Memory } from "@lib/shared/contracts";
import {
  parsePublicShareUrl,
  shareDurations,
  type ShareState,
  type ShareDuration,
} from "@lib/shared/sharing";
import { noteSummary, renderNote } from "./reader.ts";
import { userMessage } from "./messages.ts";
import { copyText } from "./writing/clipboard.ts";

/** One focused dialog; publishing is always a separate, explicit user action. */
export function resolveShareUrl(
  state: ShareState | undefined,
  siteOrigin: string,
  now = Date.now(),
): string | null {
  const value = state?.direct;
  if (
    !value?.active ||
    !value.url ||
    (value.expiresAt && Date.parse(value.expiresAt) <= now)
  )
    return null;
  try {
    return parsePublicShareUrl(value.url, siteOrigin);
  } catch {
    return null;
  }
}

export class ShareController {
  private epoch = 0;
  private note: Memory | undefined;
  private state: ShareState | undefined;
  private busy = false;
  private id: string | undefined;
  private readonly dialog = document.getElementById(
    "sharing",
  ) as HTMLDialogElement;
  private element<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id) as T;
  }
  constructor(
    private transport: {
      rpc<T>(kind: string, input?: unknown): Promise<T>;
      siteOrigin: string;
      approvalUrl(): string;
    },
  ) {
    const duration = this.element<HTMLSelectElement>("share-duration");
    duration.add(new Option("No expiry", ""));
    for (const [value, choice] of Object.entries(shareDurations))
      duration.add(new Option(choice.label, value));
    duration.value = "1w";
    duration.addEventListener("change", () => this.paint());
    this.element("close-sharing").onclick = () => this.close();
    this.dialog.addEventListener("close", () => {
      this.epoch++;
      this.note = undefined;
      this.state = undefined;
      this.element("share-preview").replaceChildren();
      this.element<HTMLInputElement>("share-link").value = "";
    });
    this.element("share-retry").onclick = () => {
      if (this.id) void this.open(this.id);
    };
    this.element("create-share").onclick = () => {
      void this.mutate(false);
    };
    this.element("revoke-share").onclick = () => {
      void this.mutate(true);
    };
    this.element("copy-share").onclick = () => {
      void this.copy();
    };
  }
  close() {
    this.epoch++;
    this.dialog.close();
  }
  private url() {
    return resolveShareUrl(this.state, this.transport.siteOrigin, Date.now());
  }
  private paint() {
    const link = this.url();
    this.element<HTMLInputElement>("share-link").value = link ?? "";
    this.element("share-link-tools").hidden = !link;
    this.element("share-new").hidden =
      !!link || !this.state?.available || !this.state.canShare;
    this.element("share-options").hidden =
      !link && (!this.state?.available || !this.state.canShare);
    this.element("share-existing-options").hidden = !link;
    this.element("share-expiry").hidden = !!link;
    const duration = this.element<HTMLSelectElement>("share-duration").value;
    this.element("share-expiry-label").textContent = link
      ? this.state?.direct?.expiresAt
        ? `Expires ${new Date(this.state.direct.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : "No expiry"
      : duration
        ? shareDurations[duration as ShareDuration].label
        : "No expiry";
    this.element("share-status").textContent =
      this.state && !this.state.available
        ? "Sharing isn’t available right now."
        : this.state && !this.state.canShare
          ? "This note can’t be shared right now."
          : "";
  }
  private setBusy(busy: boolean) {
    this.busy = busy;
    for (const id of [
      "create-share",
      "copy-share",
      "revoke-share",
      "share-duration",
    ])
      this.element<HTMLButtonElement | HTMLSelectElement>(id).disabled = busy;
  }
  private problem(error: unknown, fallback: string) {
    this.state = undefined;
    this.paint();
    this.element("share-status").textContent = userMessage(error, fallback);
    this.element("share-approval").hidden = ![
      "sharing_permission_required",
      "forbidden",
    ].includes((error as { code?: string } | null)?.code ?? "");
    this.element("share-retry").hidden = false;
  }
  private focusAction(previous: Element | null) {
    if (
      !this.dialog.open ||
      ![document.body, this.dialog, previous].includes(document.activeElement)
    )
      return;
    const id = !this.element("share-retry").hidden
      ? "share-retry"
      : this.url()
        ? "copy-share"
        : !this.element("share-new").hidden
          ? "create-share"
          : "close-sharing";
    this.element(id).focus({ preventScroll: true });
  }
  async open(id: string) {
    const fresh = id !== this.id || !this.dialog.open;
    const previous = document.activeElement;
    this.id = id;
    const epoch = ++this.epoch;
    this.state = undefined;
    this.note = undefined;
    this.setBusy(false);
    if (fresh)
      for (const id of ["share-note", "share-options"])
        this.element<HTMLDetailsElement>(id).open = false;
    this.element("share-title").textContent = "Share note";
    this.element("share-note-title").textContent = "Note";
    this.element("share-preview").replaceChildren();
    this.element<HTMLInputElement>("share-link").value = "";
    this.element("share-status").textContent = "Opening…";
    this.element("share-new").hidden = true;
    this.element("share-link-tools").hidden = true;
    this.element("share-options").hidden = true;
    this.element("share-approval").hidden = true;
    this.element("share-retry").hidden = true;
    this.element<HTMLAnchorElement>("share-approval").href =
      this.transport.approvalUrl();
    if (!this.dialog.open) this.dialog.showModal();
    try {
      // The preview and saved version are rechecked before publishing.
      const note = await this.transport.rpc<Memory>("read", id);
      if (epoch !== this.epoch) return;
      this.note = note;
      this.element("share-note-title").textContent = noteSummary(
        note.content,
      ).title;
      this.element("share-preview").replaceChildren(
        renderNote(note.content, this.transport.siteOrigin, document, true),
      );
      const state = await this.transport.rpc<ShareState>("sharing", id);
      if (epoch !== this.epoch) return;
      if (state.target.version !== note.version) {
        this.element("share-status").textContent =
          "This note changed. Reopen it to share.";
        this.element("share-retry").hidden = false;
        return;
      }
      this.state = state;
      this.element<HTMLSelectElement>("share-duration").value = state.direct
        ? (state.direct.duration ?? "")
        : "1w";
      this.paint();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.problem(error, "Couldn’t open sharing. Try again.");
    } finally {
      if (epoch === this.epoch) this.focusAction(previous);
    }
  }
  private async mutate(revoke: boolean) {
    if (this.busy || !this.note || !this.state) return;
    const epoch = this.epoch,
      note = this.note,
      direct = this.state.direct;
    this.setBusy(true);
    const button = this.element<HTMLButtonElement>(
      revoke ? "revoke-share" : "create-share",
    );
    this.element("share-status").textContent = revoke
      ? "Turning off…"
      : "Creating link…";
    try {
      const state = await this.transport.rpc<ShareState>(
        revoke ? "unshare" : "publish",
        revoke
          ? {
              id: note.id,
              shareId: direct!.id,
              expectedVersion: direct!.version,
            }
          : {
              id: note.id,
              expectedVersion: direct?.version ?? 0,
              expectedTargetVersion: note.version,
              duration:
                (this.element<HTMLSelectElement>("share-duration")
                  .value as ShareDuration) || null,
            },
      );
      if (epoch !== this.epoch) return;
      this.state = state;
      this.paint();
      if (revoke) this.element("share-status").textContent = "Link turned off.";
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.problem(error, "Not confirmed. Check sharing before trying again.");
    } finally {
      if (epoch === this.epoch) {
        this.setBusy(false);
        this.focusAction(button);
      }
    }
  }
  private async copy() {
    if (!this.note || this.busy) return;
    const epoch = this.epoch;
    this.setBusy(true);
    this.element("share-status").textContent = "Checking link…";
    try {
      const state = await this.transport.rpc<ShareState>(
        "sharing",
        this.note.id,
      );
      if (epoch !== this.epoch) return;
      this.state = state;
      this.paint();
      const link = this.url();
      if (!link) return;
      if (await copyText(link)) {
        if (epoch === this.epoch)
          this.element("share-status").textContent = "Link copied.";
      } else {
        if (epoch !== this.epoch) return;
        this.element("share-status").textContent =
          "Select the link to copy it.";
        this.element<HTMLDetailsElement>("share-options").open = true;
        const input = this.element<HTMLInputElement>("share-link");
        input.focus();
        input.select();
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.problem(error, "Couldn’t check sharing. Try again.");
    } finally {
      if (epoch === this.epoch) {
        this.setBusy(false);
        this.focusAction(this.element("copy-share"));
      }
    }
  }
}
