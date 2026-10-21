"use client";
import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { Download, SlidersHorizontal } from "lucide-react";
import { ConnectedAccounts } from "@/components/dashboard/connected-accounts";
import { LoadError } from "@/components/dashboard/load-error";
import { api, errorMessage } from "@/lib/dashboard-api";
import { useToast } from "./toasts";

type Settings = {
  captureEnabled: boolean;
  recallEnabled: boolean;
  organizeEnabled: boolean;
  summariesEnabled: boolean;
  accountId: string;
};
const preferenceKeys = [
  "captureEnabled",
  "recallEnabled",
  "organizeEnabled",
  "summariesEnabled",
] as const;
export function SettingsPanel({
  section = "preferences",
}: {
  section?: "preferences" | "account" | "data";
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [refresh, setRefresh] = useState(0);
  const { signOut } = useClerk();
  const dirty =
    !!settings &&
    preferenceKeys.some(
      (key) => (settings[key] ?? true) !== (saved?.[key] ?? true),
    );
  useEffect(() => {
    if (section !== "preferences") return;
    const controller = new AbortController();
    api<Settings>("/me", undefined, undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSettings(value);
        setSaved(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [refresh, section]);
  async function update() {
    if (!settings || busy || !dirty) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/account/settings",
        {
          captureEnabled: settings.captureEnabled,
          recallEnabled: settings.recallEnabled,
          organizeEnabled: settings.organizeEnabled,
          summariesEnabled: settings.summariesEnabled,
        },
        "PATCH",
      );
      setSaved(settings);
      toast("Preferences saved.");
    } catch (e) {
      setError(errorMessage(e));
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && !settings ? (
        <LoadError
          message={error}
          retry={() => {
            setError("");
            setRefresh((value) => value + 1);
          }}
        />
      ) : error && section !== "preferences" ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-content">
        {section === "preferences" && (
          <>
            <section className="app-panel">
              <h2 className="flex items-center gap-3 font-editorial text-2xl">
                <SlidersHorizontal size={19} />
                Your preferences
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
                    Let connected agents find useful notes when starting work
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
                    Let connected agents save confirmed details
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={settings.organizeEnabled ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          organizeEnabled: e.target.checked,
                        })
                      }
                    />
                    Help organize my notes and find related ideas
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={settings.summariesEnabled ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          summariesEnabled: e.target.checked,
                        })
                      }
                    />
                    Enable Ask Grove and notebook summaries
                  </label>
                  <p className="text-xs leading-6 text-muted">
                    You can always write and edit notes yourself. Connected
                    agents only use the notebooks and permissions you’ve
                    approved.
                  </p>
                  <div className="settings-save-row">
                    <button
                      className="app-button w-fit"
                      disabled={busy || !dirty}
                    >
                      Save preferences
                    </button>
                    <p
                      className="settings-save-status"
                      role="status"
                      aria-live="polite"
                    >
                      {busy
                        ? "Saving…"
                        : error
                          ? "Couldn’t save. Try again."
                          : dirty
                            ? "Unsaved changes"
                            : "All changes saved"}
                    </p>
                  </div>
                </form>
              ) : (
                <p
                  className="settings-loading mt-4 text-sm text-muted"
                  role="status"
                >
                  {error
                    ? "Your preferences couldn’t be loaded."
                    : "Loading preferences…"}
                </p>
              )}
            </section>
          </>
        )}
        {section === "account" && (
          <>
            <section className="app-panel">
              <h2 className="font-editorial text-2xl">About you</h2>
              <p className="mt-3 text-sm text-muted">
                Preferences and details you want Grove to remember.
              </p>
              <Link className="text-button mt-4" href="/app/profile">
                Edit what Grove knows about you
              </Link>
            </section>
            <ConnectedAccounts />
          </>
        )}
        {section === "data" && (
          <>
            <section className="app-panel">
              <h2 className="font-editorial text-2xl">
                Take your notes with you
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted">
                Download your notes, earlier versions, and conversations.
              </p>
              <a
                className="app-button secondary mt-5"
                href="/api/grove/account/export"
                download
              >
                <Download size={15} />
                Export notes
              </a>
            </section>
            <section className="app-panel">
              <h2 className="font-editorial text-2xl">
                Delete your Grove account
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted">
                Access ends immediately. Your notes, history, notebooks,
                connections, and sign-in account will be permanently removed.
                This cannot be undone.
              </p>
              <form
                className="app-form mt-5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    await api("/account/delete", { confirm: confirmation });
                    toast(
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
          </>
        )}
      </div>
    </>
  );
}
