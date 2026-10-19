"use client";
import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Download, SlidersHorizontal } from "lucide-react";
import { ConnectedAccounts } from "@/components/dashboard/connected-accounts";
import { api, errorMessage } from "@/lib/dashboard-api";

type Settings = {
  captureEnabled: boolean;
  recallEnabled: boolean;
  accountId: string;
};
export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const { signOut } = useClerk();
  useEffect(() => {
    const controller = new AbortController();
    api<Settings>("/me", undefined, undefined, controller.signal)
      .then(setSettings)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);
  async function update() {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/account/settings",
        {
          captureEnabled: settings.captureEnabled,
          recallEnabled: settings.recallEnabled,
        },
        "PATCH",
      );
      setNotice("Memory preferences saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="app-page-heading">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>
            Your settings<span className="text-leaf">.</span>
          </h1>
          <p>Useful context, with you in control.</p>
        </div>
      </div>
      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      <div className="max-w-3xl space-y-6">
        <section className="app-panel">
          <h2 className="flex items-center gap-3 font-editorial text-2xl">
            <SlidersHorizontal size={19} />
            Memory preferences
          </h2>
          {settings ? (
            <form
              className="app-form mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                void update();
              }}
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.recallEnabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      recallEnabled: e.target.checked,
                    })
                  }
                />
                Automatically recall bounded context at task start
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.captureEnabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      captureEnabled: e.target.checked,
                    })
                  }
                />
                Allow agent-requested capture of confirmed context
              </label>
              <p className="text-xs leading-6 text-muted">
                Hooks never upload transcripts. Explicit saves remain available
                when automatic capture is paused. Use GROVE_PRIVATE=1 or grove
                pause locally to stop automatic memory activity.
              </p>
              <button className="app-button w-fit" disabled={busy}>
                Save preferences
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-muted">Loading preferences…</p>
          )}
        </section>
        <ConnectedAccounts />
        <section className="app-panel">
          <h2 className="font-editorial text-2xl">
            Take your memories with you.
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted">
            Download an NDJSON export of your memories, archived items, and
            revisions.
          </p>
          <a
            className="app-button secondary mt-5"
            href="/api/grove/account/export"
            download
          >
            <Download size={15} />
            Export memories
          </a>
        </section>
        <section className="app-panel">
          <h2 className="font-editorial text-2xl">Delete your Grove account</h2>
          <p className="mt-3 text-sm leading-7 text-muted">
            Access is revoked immediately. Your memories, revisions, embeddings,
            projects, connections, and Clerk identity are queued for permanent
            removal. This cannot be undone.
          </p>
          <form
            className="app-form mt-5"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/account/delete", { confirm: confirmation });
                setNotice(
                  "Deletion requested. Your account is no longer accessible.",
                );
                await signOut({ redirectUrl: "/" });
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Type “delete my account” to confirm
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              className="app-button danger w-fit"
              disabled={busy || confirmation !== "delete my account"}
            >
              Delete my account
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
