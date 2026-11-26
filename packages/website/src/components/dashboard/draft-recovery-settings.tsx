"use client";
import { useState } from "react";
import Link from "next/link";
import { useNoteDrafts, useNoteDraftRevision } from "./note-drafts";
import { useWorkspaceCache } from "./workspace-cache";

export function DraftRecoverySettings() {
  const drafts = useNoteDrafts();
  const cache = useWorkspaceCache();
  useNoteDraftRevision();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Device recovery couldn’t change. Keep this tab open and copy or export unsaved text.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!drafts) return null;
  const recovered = [...drafts].filter(([, value]) => value.recovered);
  return (
    <section
      className="app-panel grid gap-3"
      aria-labelledby="draft-recovery-heading"
    >
      <h2 id="draft-recovery-heading" className="font-editorial text-2xl">
        Draft recovery on this device
      </h2>
      <p className="text-sm text-muted" id="draft-recovery-help">
        Off by default. When enabled, Grove keeps encrypted draft checkpoints
        for this account in this browser: up to 32 drafts and 1 MiB, for seven
        days from the first checkpoint. Sign-out, account changes and turning
        this off erase them. Unsaved text in an open tab stays in memory.
      </p>
      <p className="text-sm text-muted">
        This is not a server save or protection against a compromised browser or
        site. Recovery needs an online sign-in and current note access. A recent
        typing burst may not be checkpointed; closed or offline browsers cannot
        be remotely wiped.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-describedby="draft-recovery-help"
          checked={drafts.enabled}
          disabled={busy || drafts.initializing}
          onChange={(event) =>
            void run(() =>
              event.target.checked ? drafts.enable() : drafts.forgetDevice(),
            )
          }
        />
        Recover drafts on this device
      </label>
      <p className="text-sm text-muted" role="status">
        {busy
          ? "Updating device recovery…"
          : drafts.initializing
            ? "Checking device storage…"
            : error ||
              drafts.recoveryError ||
              (drafts.enabled
                ? "Enabled for this account and browser. Device checkpoints are separate from Saved."
                : "Off. New drafts stay in this tab’s memory only.")}
      </p>
      {drafts.recoveryError && !drafts.size && (
        <button
          type="button"
          className="text-button w-fit"
          disabled={busy}
          onClick={() => void run(() => drafts.initialize(cache))}
        >
          Retry unlocking device drafts
        </button>
      )}
      {drafts.recoveryError && (
        <button
          type="button"
          className="text-button w-fit"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Erase this account’s device checkpoints and key? Open text stays in memory. Export anything you need before confirming.",
              )
            )
              void run(() => drafts.forgetDevice());
          }}
        >
          Forget device checkpoints
        </button>
      )}
      {recovered.length > 0 && (
        <ul className="grid gap-2" aria-label="Recovered drafts">
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
                  {value.content.match(/^#\s+(.+)/m)?.[1] || "Recovered draft"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
