"use client";
import { useState } from "react";
import Link from "next/link";
import { useNoteDrafts, useNoteDraftRevision } from "./note-drafts";
import { useWorkspaceCache } from "./workspace-cache";
import { Dialog } from "./dialog";

export function DraftRecoverySettings() {
  const drafts = useNoteDrafts();
  const cache = useWorkspaceCache();
  useNoteDraftRevision();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgetting, setForgetting] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("Couldn’t update recovery. Keep this tab open and try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!drafts) return null;
  const recovered = [...drafts].filter(([, value]) => value.recovered);
  return (
    <section
      className="draft-recovery"
      aria-labelledby="draft-recovery-heading"
    >
      <h2 id="draft-recovery-heading">Draft recovery</h2>
      <label className="draft-recovery-toggle">
        <span>
          <span className="draft-recovery-label">
            Recover drafts on this device
          </span>
          <span id="draft-recovery-help">
            Encrypted here for up to 7 days. Not a server save.
          </span>
        </span>
        <input
          type="checkbox"
          name="device-draft-recovery"
          aria-label="Recover drafts on this device"
          aria-describedby="draft-recovery-help"
          checked={drafts.enabled}
          disabled={busy || drafts.initializing}
          onChange={(event) => {
            if (event.target.checked) void run(() => drafts.enable());
            else setForgetting(true);
          }}
        />
      </label>
      <p className="draft-recovery-consequence">
        Signing out or turning this off deletes device copies.
      </p>
      <details className="draft-recovery-details">
        <summary>Privacy and limits</summary>
        <ul>
          <li>
            Up to 32 drafts and 16 MiB, for 7 days from the first device copy.
          </li>
          <li>Recovery needs an online sign-in and current note access.</li>
          <li>
            Recent typing may not be copied yet. Export important unsaved text.
          </li>
          <li>
            Switching accounts deletes device copies. Closed or offline browsers
            cannot be remotely wiped.
          </li>
          <li>
            Encryption does not protect against a compromised browser or site.
          </li>
        </ul>
      </details>
      <div className="draft-recovery-feedback">
        <p role="status">
          {busy
            ? "Updating device recovery…"
            : drafts.initializing
              ? "Checking device storage…"
              : error ||
                (drafts.recoveryError
                  ? "Device recovery needs attention. Keep this tab open."
                  : "") ||
                (drafts.enabled
                  ? "On for this browser."
                  : "Off. Drafts stay in this tab.")}
        </p>
        {drafts.recoveryError && !drafts.size && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void run(() => drafts.initialize(cache))}
          >
            Retry recovery
          </button>
        )}
      </div>
      {drafts.recoveryError && (
        <button
          type="button"
          className="text-button draft-recovery-delete"
          disabled={busy}
          onClick={() => setForgetting(true)}
        >
          Delete device copies…
        </button>
      )}
      {recovered.length > 0 && (
        <div className="draft-recovery-list">
          <h3>Recovered drafts</h3>
          <ul aria-label="Recovered drafts">
            {recovered.map(([key, value]) => {
              const query = new URLSearchParams(
                value.dailyDate
                  ? { from: "journal", date: value.dailyDate }
                  : value.projectId
                    ? { notebook: value.projectId }
                    : {},
              );
              const href = value.base
                ? `/app/memories/${value.base.id}?mode=edit`
                : `/app/notes/new?${query}`;
              return (
                <li key={key}>
                  <Link className="text-button" href={href}>
                    {value.content.match(/^#\s+(.+)/m)?.[1] ||
                      "Recovered draft"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {forgetting && (
        <Dialog
          title="Delete device copies?"
          busy={busy}
          close={() => setForgetting(false)}
        >
          <p className="device-copy-confirmation">
            Unsaved text in open tabs stays. Deleted device copies can’t be
            recovered.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="app-button secondary"
              data-autofocus
              disabled={busy}
              onClick={() => setForgetting(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="app-button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await drafts.forgetDevice();
                  setForgetting(false);
                })
              }
            >
              {busy ? "Deleting…" : "Delete device copies"}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
    </section>
  );
}
