"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Link2, RefreshCw } from "lucide-react";
import type { ShareState, ShareTarget } from "@lib/shared/sharing";
import { api, DashboardApiError, errorMessage } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { Select } from "./ui/select";
import { useToast } from "./toasts";
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
  onBusy,
  openNotebook,
}: {
  target: ShareTarget;
  blocked: boolean;
  onBusy: (busy: boolean) => void;
  openNotebook: (id: string) => void;
}) {
  const path = `/${target.kind === "note" ? "memories" : "projects"}/${target.id}/share`;
  const [state, setState] = useState<ShareState | null>(null);
  const [access, setAccess] = useState("restricted");
  const [descendants, setDescendants] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const operations = useRef(new Map<string, string>());
  const pending = useRef(false);
  const toast = useToast();
  function accept(value: ShareState) {
    setState(value);
    setAccess(value.direct?.active ? "anyone" : "restricted");
    setDescendants(value.direct?.includeDescendants ?? false);
  }
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
  async function mutate(action: "save" | "rotate") {
    if (!state || pending.current) return;
    const direct = state.direct;
    const revoke = action === "save" && access === "restricted";
    if (!revoke && (blocked || !state.available || !state.canShare)) return;
    const route =
      action === "rotate"
        ? `/shares/${direct!.id}/rotate`
        : revoke || direct?.active
          ? `/shares/${direct!.id}`
          : path;
    const method =
      action === "rotate" || (!revoke && !direct?.active)
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
          }
        : {}),
      ...(method === "PATCH" ? { includeDescendants: descendants } : {}),
    };
    const identity = JSON.stringify({ route, method, body });
    if (!operations.current.has(identity))
      operations.current.set(identity, crypto.randomUUID());
    pending.current = true;
    setBusy(true);
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
      toast(
        action === "rotate"
          ? "Link replaced. The previous link no longer works."
          : revoke
            ? "Direct link turned off."
            : "Sharing settings saved.",
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
      setBusy(false);
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
          <p role="status">Opening sharing settings…</p>
        )}
      </>
    );
  const active = !!state.direct?.active;
  const changed =
    (access === "anyone") !== active ||
    (active &&
      access === "anyone" &&
      descendants !== state.direct?.includeDescendants);
  const cannotPublish = blocked || !state.available || !state.canShare;
  const url = state.direct?.url;
  return (
    <>
      <p className="share-target">{state.target.name}</p>
      <p className="share-help">
        Links show the latest saved content. Visitors can view, but cannot edit.
      </p>
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
      <div className="share-access">
        <Select
          label="General access"
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
        <span className="share-permission">Can view</span>
      </div>
      <p className="share-help">
        {access === "restricted"
          ? "No direct link. Notebook links listed below may still include this content."
          : "Anyone who receives this link can read the shared content without signing in."}
      </p>
      {target.kind === "notebook" && (
        <>
          <Select
            label="Notebook scope"
            value={descendants ? "subtree" : "direct"}
            onValueChange={(value) => setDescendants(value === "subtree")}
            disabled={busy || cannotPublish}
            options={[
              { value: "direct", label: "This notebook only" },
              { value: "subtree", label: "Include sub-notebooks" },
            ]}
          />
          <p className="share-help">
            {descendants
              ? "Current and future sub-notebooks and their notes are included."
              : "Only notes directly in this notebook are included."}{" "}
            New or moved-in notes become visible after saving. Archived and
            expired notes are excluded.
          </p>
        </>
      )}
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
          <p>
            Turning off this direct link does not turn off these notebook links.
          </p>
          <ul>
            {state.inherited.map((source) => (
              <li key={source.id}>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => openNotebook(source.projectId)}
                >
                  <Link2 size={15} />
                  <span>{source.name}</span>
                  <span className="sr-only"> sharing settings</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {active && url && (
        <div className="share-link">
          <label htmlFor={`share-url-${target.id}`}>Current link</label>
          <input
            id={`share-url-${target.id}`}
            value={url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="share-actions">
            <button
              className="app-button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast("Share link copied.");
                } catch {
                  toast(
                    "Could not copy. Select the link and copy it manually.",
                    true,
                  );
                }
              }}
            >
              <Copy size={15} />
              Copy link
            </button>
            <a
              className="app-button secondary"
              href={url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={15} />
              Open link
            </a>
          </div>
        </div>
      )}
      {active && !url && state.available && (
        <p className="app-notice">
          This link cannot be recovered with the current server key. Replace it
          to get a new link, or turn it off.
        </p>
      )}
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      <div className="share-actions">
        <button
          className="app-button"
          disabled={busy || !changed || (access === "anyone" && cannotPublish)}
          onClick={() => void mutate("save")}
        >
          {busy
            ? "Saving…"
            : access === "restricted" && active
              ? "Turn off direct link"
              : "Save sharing settings"}
        </button>
        {active && (
          <button
            className="app-button secondary"
            disabled={busy || cannotPublish || changed}
            onClick={() => void mutate("rotate")}
          >
            <RefreshCw size={15} />
            Replace link
          </button>
        )}
      </div>
      {active && (
        <p className="share-help">
          Replacing the link immediately stops the previous link from working.
        </p>
      )}
    </>
  );
}
