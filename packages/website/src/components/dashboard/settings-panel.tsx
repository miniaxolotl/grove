"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { Download, SlidersHorizontal } from "lucide-react";
import { ConnectedAccounts } from "@/components/dashboard/connected-accounts";
import { LoadError } from "@/components/dashboard/load-error";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useToast } from "./toasts";

type Settings = {
  captureEnabled: boolean;
  recallEnabled: boolean;
  organizeEnabled: boolean;
  summariesEnabled: boolean;
  accountId: string;
};
export function SettingsPanel({
  section = "preferences",
}: {
  section?: "preferences" | "account" | "data";
}) {
  const cache = useWorkspaceCache();
  const api = cache.api;
  const query = useQuery({
    ...cache.resource<Settings>("/me"),
    enabled: section === "preferences",
  });
  const [draft, setSettings] = useState<Settings | null>(null);
  const settings = draft ?? query.data;
  const [saveError, setError] = useState("");
  const error = saveError || (query.error ? errorMessage(query.error) : "");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const { signOut } = useClerk();
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
          organizeEnabled: settings.organizeEnabled,
          summariesEnabled: settings.summariesEnabled,
        },
        "PATCH",
      );
      toast("Preferences saved.");
    } catch (e) {
      setError(errorMessage(e));
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
            void query.refetch();
          }}
        />
      ) : error ? (
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
                  <button className="app-button w-fit" disabled={busy}>
                    Save preferences
                  </button>
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
