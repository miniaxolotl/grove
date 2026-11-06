import type { Memory } from "@lib/shared/contracts";
import {
  shareDurations,
  shareTokenSchema,
  type ShareState,
  type ShareDuration,
} from "@lib/shared/sharing";
import { renderNote } from "./reader.ts";
import { userMessage } from "./messages.ts";

/** One focused dialog; publishing is always a separate, explicit user action. */
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
    const value = this.state?.direct;
    if (
      !value?.active ||
      !value.url ||
      (value.expiresAt && Date.parse(value.expiresAt) <= Date.now())
    )
      return null;
    try {
      const url = new URL(value.url);
      return url.origin === this.transport.siteOrigin &&
        shareTokenSchema.safeParse(url.pathname.slice(3)).success &&
        url.pathname.startsWith("/s/") &&
        !url.search &&
        !url.hash
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  private paint() {
    const link = this.url();
    this.element<HTMLInputElement>("share-link").value = link ?? "";
    this.element("share-link-tools").hidden = !link;
    this.element("share-new").hidden =
      !!link || !this.state?.available || !this.state.canShare;
    this.element("share-status").textContent = link
      ? this.state?.direct?.expiresAt
        ? `Expires ${new Date(this.state.direct.expiresAt).toLocaleDateString()}.`
        : "Link ready."
      : this.state && !this.state.available
        ? "Sharing isn’t available right now."
        : this.state && !this.state.canShare
          ? "This note can’t be shared right now."
          : "";
  }
  async open(id: string) {
    this.id = id;
    const epoch = ++this.epoch;
    this.state = undefined;
    this.note = undefined;
    this.busy = false;
    this.element("share-title").textContent = "Share note";
    this.element("share-preview").replaceChildren();
    this.element("share-status").textContent = "Opening…";
    this.element("share-new").hidden = true;
    this.element("share-link-tools").hidden = true;
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
      this.element("share-status").textContent = userMessage(
        error,
        "Couldn’t open sharing. Try again.",
      );
      this.element("share-approval").hidden = ![
        "sharing_permission_required",
        "forbidden",
      ].includes((error as { code?: string }).code ?? "");
      this.element("share-retry").hidden = false;
    }
  }
  private async mutate(revoke: boolean) {
    if (this.busy || !this.note || !this.state) return;
    const epoch = this.epoch,
      note = this.note,
      direct = this.state.direct;
    this.busy = true;
    const button = this.element<HTMLButtonElement>(
      revoke ? "revoke-share" : "create-share",
    );
    button.disabled = true;
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
      this.element("share-status").textContent = userMessage(
        error,
        "Not confirmed. Check sharing before trying again.",
      );
      this.element("share-retry").hidden = false;
      this.element("share-new").hidden = true;
      this.element("share-link-tools").hidden = true;
    } finally {
      this.busy = false;
      button.disabled = false;
      if (
        epoch === this.epoch &&
        this.dialog.open &&
        [document.body, this.dialog, button].includes(
          document.activeElement as HTMLElement,
        )
      ) {
        const next = !this.element("share-retry").hidden
          ? "share-retry"
          : this.url()
            ? "copy-share"
            : "create-share";
        this.element(next).focus({ preventScroll: true });
      }
    }
  }
  private async copy() {
    if (!this.note || this.busy) return;
    const epoch = this.epoch;
    try {
      const state = await this.transport.rpc<ShareState>(
        "sharing",
        this.note.id,
      );
      if (epoch !== this.epoch) return;
      this.state = state;
      this.paint();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.element("share-status").textContent = userMessage(
        error,
        "Couldn’t check sharing. Try again.",
      );
      this.element("share-link-tools").hidden = true;
      this.element<HTMLInputElement>("share-link").value = "";
      this.element("share-retry").hidden = false;
      return;
    }
    const link = this.url();
    if (!link) {
      this.paint();
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.element("share-status").textContent = "Link copied.";
    } catch {
      this.element("share-status").textContent = "Select the link to copy it.";
      const input = this.element<HTMLInputElement>("share-link");
      input.focus();
      input.select();
    }
  }
}
