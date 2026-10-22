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
import { AiPreferences } from "./ai-preferences";
import {
  preferenceKeys,
  preferencesFor,
  type AccountPreferences,
  type AiAvailability,
  type PreferencesUpdate,
} from "@lib/shared/preferences";

type Settings = PreferencesUpdate & {
  accountId: string;
  aiAvailability?: AiAvailability;
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
  const [draft, setDraft] = useState<AccountPreferences | null>(null);
  const loaded = query.data ? preferencesFor(query.data) : null;
  const settings = draft ?? loaded;
  const [saveError, setError] = useState("");
  const error = saveError || (query.error ? errorMessage(query.error) : "");
  const [saved, setSaved] = useState<AccountPreferences | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const { signOut } = useClerk();
  const dirty =
    !!settings &&
    preferenceKeys.some((key) => settings[key] !== (saved ?? loaded)?.[key]);
  function editSettings(value: AccountPreferences) {
    // Freeze the loaded base on the first edit. Background reads cannot acknowledge it.
    if (!draft && settings) setSaved(settings);
    setDraft(value);
  }
  async function update() {
    if (!settings || busy || !dirty) return;
    setBusy(true);
    setError("");
    try {
      const changed = Object.fromEntries(
        preferenceKeys
          .filter((key) => settings[key] !== (saved ?? loaded)?.[key])
          .map((key) => [key, settings[key]]),
      );
      await api("/account/settings", changed, "PATCH");
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
          title="Your preferences couldn’t load"
          message={error}
          retry={() => {
            setError("");
            void query.refetch();
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
            <section className="app-panel ai-preferences-panel">
              <h2 className="flex items-center gap-3 font-editorial text-2xl">
                <SlidersHorizontal size={19} />
                AI preferences
              </h2>
              <p className="ai-preferences-intro">
                Choose how Grove helps with your notes.
              </p>
              {settings ? (
                <form
                  className="app-form ai-preferences-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update();
                  }}
                >
                  <AiPreferences
                    value={settings}
                    availability={query.data?.aiAvailability}
                    onChange={editSettings}
                  />
                  <p className="text-xs leading-6 text-muted">
                    Connected agents only use the notebooks and permissions
                    you’ve approved.
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
                Export all account data
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
