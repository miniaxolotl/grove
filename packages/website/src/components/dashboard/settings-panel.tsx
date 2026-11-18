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
import { Button } from "./ui/button";
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
      <div className="settings-content">
        <div>
          <h2 className="settings-section-heading">
            {section === "account" ? "Account" : "Your data"}
          </h2>
          <p className="settings-section-description">
            {section === "account"
              ? "Your plan, sign-in and personal details."
              : "Import, export or manage your notes."}
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
                Edit personal details
              </Link>
            </section>
            <ConnectedAccounts />
          </>
        )}
        {section === "data" && (
          <>
            <section className="app-panel grid gap-3">
              <div className="grid gap-1">
                <h2 className="font-editorial font-semibold">Import notes</h2>
                <p className="text-sm text-muted">
                  Review Markdown, text, DOCX or text-based PDF files before
                  saving.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <ImportNotesButton primary />
                <Link
                  className="app-button secondary"
                  href="/app/settings/files"
                >
                  View files &amp; storage
                </Link>
              </div>
            </section>
            <section className="app-panel">
              <ExportTasks />
            </section>
            <section className="app-panel">
              <h2 className="font-editorial text-2xl">
                Delete your Grove account
              </h2>
              <p className="mt-2 text-sm text-muted">
                You lose access immediately. Your sign-in is removed, and your
                notes and history are kept privately but hidden from Grove.
              </p>
              <form
                className="app-form"
                aria-busy={busy}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy || confirmation !== "delete my account") return;
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
                    name="confirmation"
                    value={confirmation}
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                {error && (
                  <p className="app-error my-0" role="alert">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="danger"
                  className="w-fit"
                  disabled={busy || confirmation !== "delete my account"}
                >
                  {busy ? "Deleting account…" : "Delete my account"}
                </Button>
              </form>
            </section>
          </>
        )}
      </div>
    </>
  );
}
