"use client";
import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { ExportTasks } from "./export-tasks";
import { ImportNotesButton } from "./import-notes-button";
import { ConnectedAccounts } from "@/components/dashboard/connected-accounts";
import { errorMessage } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { useToast } from "./toasts";
import { PreferencesPanel } from "./preferences-panel";
import { AccountPlanDetails } from "./account-plan";
export function SettingsPanel({
  section = "preferences",
}: {
  section?: "preferences" | "account" | "data";
}) {
  return section === "preferences" ? (
    <PreferencesPanel />
  ) : (
    <AccountSettings section={section} />
  );
}

function AccountSettings({ section }: { section: "account" | "data" }) {
  const cache = useWorkspaceCache();
  const api = cache.api;
  const [error, setError] = useState("");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const { signOut } = useClerk();
  return (
    <>
      {error ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-content">
        <div>
          <h2 className="settings-section-heading">
            {section === "account" ? "Account" : "Your data"}
          </h2>
          <p className="settings-section-description">
            {section === "account"
              ? "Manage your sign-in and what Grove remembers about you."
              : "Keep a copy of your work or manage your account data."}
          </p>
        </div>
        {section === "account" && (
          <>
            <AccountPlanDetails />
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
                Bring your notes to Grove
              </h2>
              <p className="mt-3 mb-4 text-sm text-muted">
                Upload Markdown, text and PDFs, then review their notebooks
                before importing.
              </p>
              <ImportNotesButton />
            </section>
            <section className="app-panel">
              <ExportTasks />
            </section>
            <section className="app-panel">
              <h2 className="font-editorial text-2xl">
                Delete your Grove account
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted">
                Access ends immediately and your sign-in is removed. Deleted
                notes and history are retained privately and hidden from the
                app.
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
