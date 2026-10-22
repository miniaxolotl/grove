"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  Link2,
  RefreshCw,
} from "lucide-react";
import { shareDurations } from "@lib/shared/share-durations";
import type {
  ShareDuration,
  ShareState,
  ShareTarget,
} from "@lib/shared/sharing";
import { api, DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { Select } from "./ui/select";
import "./share-dialog.css";

export function ShareDialog({
  target,
  blocked = false,
  close,
}: {
  target: ShareTarget;
  blocked?: boolean;
  close: () => void;
}) {
  const [ancestors, setAncestors] = useState<ShareTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const current = ancestors.at(-1) ?? target;
  return (
    <Dialog title={`Share ${current.kind}`} close={close} busy={busy}>
      <div className="share-settings" data-private>
        {!!ancestors.length && (
          <button
            className="text-button share-back"
            disabled={busy}
            onClick={() => setAncestors((items) => items.slice(0, -1))}
          >
            <ArrowLeft size={15} /> Back to{" "}
            {ancestors.at(-2)?.kind ?? target.kind}
          </button>
        )}
        <ShareSettings
          key={`${current.kind}:${current.id}`}
          target={current}
          blocked={blocked && !ancestors.length}
          close={close}
          onBusy={setBusy}
          openNotebook={(id) =>
            setAncestors((items) => [...items, { kind: "notebook", id }])
          }
        />
      </div>
    </Dialog>
  );
}

function ShareSettings({
  target,
  blocked,
  close,
  onBusy,
  openNotebook,
}: {
  target: ShareTarget;
  blocked: boolean;
  close: () => void;
  onBusy: (busy: boolean) => void;
  openNotebook: (id: string) => void;
}) {
  const path = `/${target.kind === "note" ? "memories" : "projects"}/${target.id}/share`;
  const [state, setState] = useState<ShareState | null>(null);
  const [access, setAccess] = useState("restricted");
  const [descendants, setDescendants] = useState(false);
  const [duration, setDuration] = useState<ShareDuration | null>(null);
  const [now, setNow] = useState(Date.now);
  const [action, setAction] = useState<"save" | "rotate" | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [copyError, setCopyError] = useState("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const accessId = useId();
  const scopeId = useId();
  const expiryId = useId();
  const linkInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const operations = useRef(new Map<string, string>());
  const pending = useRef(false);
  const busy = action !== null;
  const expiresAt = state?.direct?.expiresAt;
  const expired = !!expiresAt && Date.parse(expiresAt) <= now;
  const active = !!state?.direct?.active && !expired;
  useEffect(() => {
    if (!expiresAt || expired) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(
        Math.max(0, Date.parse(expiresAt) - Date.now()) + 10,
        2_147_483_647,
      ),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, expired, now]);
  useEffect(() => {
    if (busy || !returnFocus.current) return;
    const control = returnFocus.current;
    returnFocus.current = null;
    if (
      control.isConnected &&
      (document.activeElement === document.body ||
        document.activeElement === control.closest("dialog") ||
        document.activeElement === control)
    ) {
      control.focus({ preventScroll: true });
      // Creating a link adds its URL/tools. Keep the restored action visible
      // when that extra content makes a short dialog scroll.
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [busy]);
  function accept(value: ShareState) {
    setState(value);
    setAccess(value.direct?.active ? "anyone" : "restricted");
    setDescendants(value.direct?.includeDescendants ?? false);
    setDuration(value.direct?.duration ?? null);
    setNow(Date.now());
    setCopiedUrl(null);
    setFeedback("");
    setCopyError("");
  }
  useEffect(() => {
    if (!copiedUrl) return;
    const timer = setTimeout(() => setCopiedUrl(null), 2500);
    return () => clearTimeout(timer);
  }, [copiedUrl]);
  useEffect(() => {
    const controller = new AbortController();
    api<ShareState>(path, undefined, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) accept(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [path, revision]);
  async function mutate(action: "save" | "rotate", trigger: HTMLElement) {
    if (!state || pending.current) return;
    const direct = state.direct;
    const revoke = action === "save" && access === "restricted";
    if (!revoke && (blocked || !state.available || !state.canShare)) return;
    const route =
      action === "rotate"
        ? `/shares/${direct!.id}/rotate`
        : revoke || active
          ? `/shares/${direct!.id}`
          : path;
    const method =
      action === "rotate" || (!revoke && !active)
        ? "POST"
        : revoke
          ? "DELETE"
          : "PATCH";
    const body = {
      expectedVersion: direct?.version ?? 0,
      ...(route === path
        ? {
            expectedTargetVersion: state.target.version,
            includeDescendants: descendants,
            duration,
          }
        : {}),
      ...(method === "PATCH"
        ? {
            ...(target.kind === "notebook"
              ? { includeDescendants: descendants }
              : {}),
            ...(duration !== (direct?.duration ?? null) ? { duration } : {}),
          }
        : {}),
    };
    const identity = JSON.stringify({ route, method, body });
    if (!operations.current.has(identity))
      operations.current.set(identity, crypto.randomUUID());
    pending.current = true;
    returnFocus.current = trigger;
    setAction(action);
    onBusy(true);
    setError("");
    try {
      accept(
        await api<ShareState>(
          route,
          { ...body, operationId: operations.current.get(identity) },
          method,
        ),
      );
      setFeedback(
        action === "rotate"
          ? "Link replaced"
          : revoke
            ? "Link turned off"
            : active
              ? "Changes saved"
              : "Link ready",
      );
    } catch (error) {
      if (error instanceof DashboardApiError && error.status === 409) {
        try {
          accept(await api<ShareState>(path));
          setError(
            "Sharing or saved content changed. Current settings are shown; review and try again.",
          );
        } catch {
          setError(
            "Could not refresh sharing settings. Close and reopen this dialog to try again.",
          );
        }
      } else setError(errorMessage(error));
    } finally {
      pending.current = false;
      setAction(null);
      onBusy(false);
    }
  }
  if (!state)
    return (
      <>
        {error ? (
          <div role="alert">
            <p className="app-error">{error}</p>
            <button
              className="app-button secondary"
              onClick={() => {
                setError("");
                setRevision((n) => n + 1);
              }}
            >
              Retry sharing settings
            </button>
          </div>
        ) : (
          <div className="share-loading" role="status">
            <Link2 size={18} aria-hidden="true" />
            Opening sharing settings…
          </div>
        )}
      </>
    );
  const changed =
    (access === "anyone") !== active ||
    (active &&
      access === "anyone" &&
      (descendants !== state.direct?.includeDescendants ||
        duration !== (state.direct?.duration ?? null)));
  const cannotPublish = blocked || !state.available || !state.canShare;
  const url = state.direct?.url;
  const canCopy = active && !!url && !changed;
  const copied = canCopy && copiedUrl === url;
  async function copyLink() {
    if (!url) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setFeedback("");
    } catch {
      setCopyError(
        "Could not copy. The link is selected so you can copy it manually.",
      );
      linkInput.current?.focus();
      linkInput.current?.select();
    }
  }
  return (
    <>
      <div className="share-summary">
        {target.kind === "note" ? (
          <FileText size={18} aria-hidden="true" />
        ) : (
          <Folder size={18} aria-hidden="true" />
        )}
        <div>
          <p className="share-target">{state.target.name}</p>
          <p className="share-help">Saved changes appear automatically.</p>
        </div>
      </div>
      {!state.available && (
        <p className="app-notice">
          Public sharing is not configured on this server.
        </p>
      )}
      {!state.canShare && (
        <p className="app-notice">
          This note is archived or expired and is unavailable to visitors.
          Restore it to share again.
        </p>
      )}
      {blocked && (
        <p className="app-notice">
          Finish saving or resolve the note conflict before enabling sharing or
          replacing its link. You can still turn off an existing link.
        </p>
      )}
      {expired && (
        <p className="app-notice">
          This link has expired. Create a new link to share again.
        </p>
      )}
      <div className="share-fields">
        <div className="share-field">
          <div className="share-label">
            <label htmlFor={accessId}>General access</label>
            <span className="share-permission">
              <Eye size={14} aria-hidden="true" /> Can view
            </span>
          </div>
          <Select
            id={accessId}
            aria-label="General access"
            aria-describedby={`${accessId}-help`}
            value={access}
            onValueChange={setAccess}
            disabled={busy}
            options={[
              { value: "restricted", label: "Restricted" },
              {
                value: "anyone",
                label: "Anyone with the link",
                disabled: cannotPublish && !active,
              },
            ]}
          />
          <p className="share-help" id={`${accessId}-help`}>
            {access === "restricted"
              ? active
                ? "Turn off this direct link to stop new visits."
                : state.inherited.length
                  ? "No direct link. Access through notebooks is shown below."
                  : `This ${target.kind} has no public link.`
              : "Anyone with this link can read, without signing in."}
          </p>
        </div>
        {target.kind === "notebook" && (
          <div className="share-field">
            <Select
              id={scopeId}
              label="Notebook scope"
              aria-describedby={`${scopeId}-help`}
              value={descendants ? "subtree" : "direct"}
              onValueChange={(value) => setDescendants(value === "subtree")}
              disabled={busy || cannotPublish}
              options={[
                { value: "direct", label: "This notebook only" },
                { value: "subtree", label: "Include sub-notebooks" },
              ]}
            />
            <p className="share-help" id={`${scopeId}-help`}>
              {descendants
                ? "Includes current and future sub-notebooks and their notes."
                : "Only notes filed directly in this notebook."}{" "}
              New notes are included when saved; archived and expired notes stay
              hidden.
            </p>
          </div>
        )}
        {access === "anyone" && (
          <div className="share-field">
            <Select
              id={expiryId}
              label="Link expires"
              aria-describedby={`${expiryId}-help`}
              value={duration ?? "never"}
              onValueChange={(value) =>
                setDuration(value === "never" ? null : (value as ShareDuration))
              }
              disabled={busy || cannotPublish}
              options={[
                { value: "never", label: "No expiry" },
                ...Object.entries(shareDurations).map(([value, option]) => ({
                  value,
                  label: option.label,
                })),
              ]}
            />
            <p className="share-help" id={`${expiryId}-help`}>
              {active && expiresAt && duration === state.direct?.duration ? (
                <>
                  Expires{" "}
                  <time dateTime={expiresAt}>
                    {new Date(expiresAt).toLocaleString()}
                  </time>
                  .
                </>
              ) : duration ? (
                `Starts when you save.${duration === "1mo" ? " 1 month is 30 days." : ""}`
              ) : (
                "Available until you turn off the link."
              )}
            </p>
          </div>
        )}
      </div>
      {!!state.inherited.length && (
        <section
          className="share-inherited"
          aria-label="Notebook links including this content"
        >
          <h3>
            {state.canShare
              ? "Also shared through notebooks"
              : "Included when restored"}
          </h3>
          <p className="share-help">
            These links keep their access when you turn off the direct link.
          </p>
          <ul>
            {state.inherited.map((source) => (
              <li key={source.id}>
                <button
                  className="share-inherited-link"
                  disabled={busy}
                  onClick={() => openNotebook(source.projectId)}
                >
                  <Link2 size={15} aria-hidden="true" />
                  <span>{source.name}</span>
                  <span className="sr-only"> sharing settings</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {active && (
        <div className="share-link">
          {url && (
            <>
              <div className="share-label">
                <label htmlFor={`share-url-${target.id}`}>Current link</label>
                {changed && (
                  <span className="share-help">Changes not saved</span>
                )}
              </div>
              <div className="share-url">
                <input
                  ref={linkInput}
                  id={`share-url-${target.id}`}
                  value={url}
                  readOnly
                  spellCheck={false}
                  disabled={busy || changed}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <a
                  className="app-icon"
                  href={busy || changed ? undefined : url}
                  aria-disabled={busy || changed || undefined}
                  aria-label="Open link in a new tab"
                  title="Open link in a new tab"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </a>
              </div>
            </>
          )}
          {!url && state.available && (
            <p className="app-notice">
              This link cannot be recovered with the current server key. Replace
              it to get a new link, or turn it off.
            </p>
          )}
          <div className="share-link-tools">
            <button
              className="share-text-action"
              disabled={busy || cannotPublish || changed}
              aria-describedby={`share-replace-${target.id}`}
              onClick={(event) => void mutate("rotate", event.currentTarget)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {action === "rotate" ? "Replacing…" : "Replace link"}
            </button>
            <span className="share-help" id={`share-replace-${target.id}`}>
              The previous link will stop working.
            </span>
          </div>
        </div>
      )}
      {(error || copyError) && (
        <p className="app-error" role="alert">
          {error || copyError}
        </p>
      )}
      <div className="share-footer">
        <p className="share-feedback" role="status">
          {!changed &&
            (copied ? (
              <span className="sr-only">Share link copied.</span>
            ) : (
              feedback
            ))}
        </p>
        {(changed || canCopy) && (
          <button
            key="dismiss"
            className="app-button secondary"
            disabled={busy}
            onClick={() => {
              if (changed) {
                accept(state);
                setError("");
                document.getElementById(accessId)?.focus();
              } else close();
            }}
          >
            {changed ? "Cancel" : "Done"}
          </button>
        )}
        <button
          key="primary"
          className="app-button share-primary"
          aria-label={canCopy ? "Copy link" : undefined}
          disabled={busy || (changed && access === "anyone" && cannotPublish)}
          onClick={(event) => {
            if (changed) void mutate("save", event.currentTarget);
            else if (canCopy) void copyLink();
            else close();
          }}
        >
          {canCopy &&
            (copied ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            ))}
          {action === "save"
            ? "Saving…"
            : changed
              ? access === "restricted" && active
                ? "Turn off direct link"
                : active
                  ? "Save changes"
                  : "Create link"
              : canCopy
                ? copied
                  ? "Copied"
                  : "Copy link"
                : "Done"}
        </button>
      </div>
    </>
  );
}
