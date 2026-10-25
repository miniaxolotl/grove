"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Mail, ShieldCheck, AlertTriangle } from "lucide-react";
import type {
  AccessGrant,
  AdminAccount,
  AdminAudit,
  AdminChange,
  AdminDetails,
  AdminSettings,
  AdminSupportChange,
  AdminSupportState,
  AdminUser,
  SystemRole,
} from "@lib/shared/system-admin";
import { DashboardApiError } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { Dialog } from "./dialog";
import { accessName, roleName, shortDate, AdminHistory } from "./admin-history";

export const adminDenied = (error: unknown) =>
  error instanceof DashboardApiError && [401, 403].includes(error.status);
type Section = "usage" | "account" | "access";
type Destination = Section | "close";
type Draft = { settings: AdminSettings; access: AccessGrant; role: SystemRole };
type Phase = "idle" | "saving" | "uncertain" | "conflict" | "reviewing";
type Operation =
  | { kind: "access"; body: AdminChange }
  | { kind: "account"; body: AdminSupportChange };
const draftFrom = (state: AdminDetails): Draft => ({
  settings: { ...state.settings },
  access: state.account.access,
  role: state.account.role,
});

export function AccountInspector({
  account,
  audit,
  close,
  saved,
  accessDenied,
}: {
  account: AdminUser;
  audit: AdminAudit[];
  close: () => void;
  saved: () => void;
  accessDenied: () => void;
}) {
  const cache = useWorkspaceCache();
  const opening = useId();
  const details = useQuery({
    // Each opening gets a fresh snapshot, without unmounting a live editor when
    // the workspace's minute-by-minute query invalidation refreshes this read.
    queryKey: ["admin-details", account.accountId, opening],
    queryFn: ({ signal }) =>
      cache.api<AdminDetails>(
        "/admin/accounts/details",
        { accountId: account.accountId },
        "POST",
        signal,
      ),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  useEffect(() => {
    if (adminDenied(details.error)) accessDenied();
  }, [details.error, accessDenied]);
  return details.data && !adminDenied(details.error) ? (
    <AccountWorkspace
      initial={details.data}
      identity={account}
      audit={audit}
      close={close}
      saved={saved}
      accessDenied={accessDenied}
      refreshError={!!details.error}
      refresh={() => void details.refetch()}
    />
  ) : (
    <Dialog title="Manage account" close={close} variant="inspector">
      <div className="inspector-body admin-inspector-loading">
        {details.error && !adminDenied(details.error) ? (
          <div role="alert">
            <p>Couldn’t load this account.</p>
            <button
              className="text-button"
              onClick={() => void details.refetch()}
            >
              Try again
            </button>
          </div>
        ) : (
          <p role="status">Loading account…</p>
        )}
      </div>
    </Dialog>
  );
}

function AccountWorkspace({
  initial,
  identity,
  audit,
  close,
  saved,
  accessDenied,
  refreshError,
  refresh,
}: {
  initial: AdminDetails;
  identity: AdminUser;
  audit: AdminAudit[];
  close: () => void;
  saved: () => void;
  accessDenied: () => void;
  refreshError: boolean;
  refresh: () => void;
}) {
  const cache = useWorkspaceCache();
  const [state, setState] = useState(initial);
  const [lastRead, setLastRead] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const [section, setSection] = useState<Section>("usage");
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [exit, setExit] = useState<Destination | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [latest, setLatest] = useState<AdminDetails | null>(null);
  const [copyFallback, setCopyFallback] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const comparison = useRef<HTMLDivElement>(null);
  const operation = useRef<Operation | null>(null);
  const pending = useRef(false);
  const afterSave = useRef<Destination | null>(null);
  const busy = phase === "saving" || phase === "reviewing";
  const locked = phase !== "idle";
  const settingsChanged =
    JSON.stringify(draft.settings) !== JSON.stringify(state.settings);
  const accessChanged =
    draft.access !== state.account.access || draft.role !== state.account.role;
  const changed = settingsChanged || accessChanged;
  const dirty = changed || !!reason.trim();
  const availabilityChanged =
    draft.settings.suspended !== state.settings.suspended;
  const roleChanged = draft.role !== state.account.role;
  const canSave = changed && reason.trim().length >= 3;
  const displayName = identity.name || identity.email || identity.subject;
  const accountStatus = state.settings.suspended
    ? "Suspended"
    : state.account.status === "active"
      ? "Active"
      : "Unavailable";
  const history = audit.filter(
    (entry) => entry.accountId === state.account.accountId,
  );

  // Adopt a background snapshot only while clean. A draft keeps its original
  // conflict base; a delayed pre-save read must never roll a confirmed save back.
  if (initial !== lastRead) {
    setLastRead(initial);
    if (
      !dirty &&
      phase === "idle" &&
      initial.account.version >= state.account.version
    ) {
      setState(initial);
      setDraft(draftFrom(initial));
    }
  }

  useEffect(() => {
    if (!dirty && phase !== "uncertain") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, phase]);

  useEffect(() => {
    if (latest) {
      comparison.current?.focus({ preventScroll: true });
      comparison.current?.scrollIntoView({ block: "start" });
    }
  }, [latest]);

  const go = (destination: Destination) => {
    if (destination === "close") close();
    else {
      setSection(destination);
      setFeedback("");
      setCopyFallback(null);
    }
  };
  const focusSection = () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // Do not steal focus if the operator already continued into another field
      // or opened a new modal before this frame ran.
      if (active?.closest("dialog") && !active.matches(":disabled")) return;
      navigation.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus({ preventScroll: true });
    });
  };
  const requestExit = (destination: Destination) => {
    if (busy || destination === section) return;
    if (dirty || phase === "uncertain") setExit(destination);
    else go(destination);
  };
  const reset = (next: AdminDetails) => {
    setState(next);
    setDraft(draftFrom(next));
    setReason("");
    setPhase("idle");
    setError("");
    setLatest(null);
    operation.current = null;
  };
  const discard = () => {
    reset(latest ?? state);
    const destination = exit;
    setExit(null);
    if (destination) go(destination);
    if (destination !== "close") focusSection();
  };
  const readDetails = () =>
    cache.api<AdminDetails>(
      "/admin/accounts/details",
      { accountId: state.account.accountId },
      "POST",
    );

  async function save() {
    if (pending.current) return;
    pending.current = true;
    setPhase("saving");
    setError("");
    setFeedback("");
    const request = (operation.current ??=
      section === "access"
        ? {
            kind: "access",
            body: {
              accountId: state.account.accountId,
              operationId: crypto.randomUUID(),
              expectedVersion: state.account.version,
              access: draft.access,
              role: draft.role,
              reason: reason.trim(),
            },
          }
        : {
            kind: "account",
            body: {
              accountId: state.account.accountId,
              operationId: crypto.randomUUID(),
              expectedVersion: state.account.version,
              expectedSettings: state.settings,
              settings: draft.settings,
              reason: reason.trim(),
            },
          });
    try {
      let confirmed: AdminDetails;
      if (request.kind === "access") {
        const account = await cache.api<AdminAccount>(
          "/admin/accounts",
          request.body,
          "PATCH",
        );
        confirmed = { ...state, account };
      } else {
        const result = await cache.api<AdminSupportState>(
          "/admin/accounts/support",
          request.body,
          "PATCH",
        );
        confirmed = { ...state, ...result };
      }
      // The mutation response is authoritative even if the following read fails.
      // Never turn a confirmed save into an uncertain mutation or reuse its ID.
      let message = "Changes saved.";
      try {
        confirmed = await readDetails();
      } catch (failure) {
        if (adminDenied(failure)) {
          accessDenied();
          return;
        }
        message =
          "Changes saved. Usage couldn’t refresh; reopen the account to try again.";
      }
      reset(confirmed);
      setFeedback(message);
      saved();
      const destination = afterSave.current;
      afterSave.current = null;
      if (destination) go(destination);
      if (destination !== "close") {
        // A successful save disables its submit button. Safari otherwise drops
        // keyboard focus onto the page body instead of keeping it in the dialog.
        focusSection();
      }
    } catch (failure) {
      afterSave.current = null;
      if (adminDenied(failure)) {
        accessDenied();
        return;
      }
      if (failure instanceof DashboardApiError && failure.status < 500) {
        setPhase("conflict");
        setError(
          failure.code === "last_system_admin"
            ? "You can’t suspend yourself or remove the last active administrator. Review the saved account before changing it."
            : "This account changed or the edit was rejected. Review the latest saved values before trying again.",
        );
      } else {
        setPhase("uncertain");
        setError(
          "The change isn’t confirmed. Retry the same change to check its result safely. Don’t start a replacement edit.",
        );
      }
    } finally {
      pending.current = false;
    }
  }

  async function reviewLatest() {
    if (pending.current) return;
    pending.current = true;
    setPhase("reviewing");
    try {
      setLatest(await readDetails());
      setPhase("conflict");
    } catch (failure) {
      if (adminDenied(failure)) accessDenied();
      else {
        setError(
          "Couldn’t load the latest account. Your unsaved changes are still here.",
        );
        setPhase("conflict");
      }
    } finally {
      pending.current = false;
    }
  }

  const keepForReview = () => {
    if (!latest) return;
    // Reapply only explicitly changed fields, never a stale whole-settings snapshot.
    const settings = { ...latest.settings };
    for (const key of [
      "captureEnabled",
      "recallEnabled",
      "suspended",
      "supportNote",
    ] as const) {
      if (draft.settings[key] !== state.settings[key])
        Object.assign(settings, { [key]: draft.settings[key] });
    }
    setDraft({
      settings,
      access:
        draft.access !== state.account.access
          ? draft.access
          : latest.account.access,
      role:
        draft.role !== state.account.role ? draft.role : latest.account.role,
    });
    setState(latest);
    setLatest(null);
    setPhase("idle");
    setError("");
    operation.current = null;
    setFeedback(
      "Latest account loaded. Review your changes and save again when ready.",
    );
    focusSection();
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFallback(null);
      setFeedback(`${label} copied.`);
    } catch {
      setCopyFallback({ label, value });
      setFeedback("Copy isn’t available. Select and copy the text below.");
    }
  };
  const submit = () => {
    if (busy || phase === "conflict") return;
    if (phase === "uncertain") {
      void save();
      return;
    }
    if (!canSave || (section === "access" && state.account.status !== "active"))
      return;
    if (availabilityChanged || roleChanged) setConfirm(true);
    else void save();
  };
  const actionLabel =
    phase === "saving"
      ? "Saving…"
      : phase === "uncertain"
        ? "Retry same change"
        : availabilityChanged
          ? draft.settings.suspended
            ? "Review suspension"
            : "Review restoration"
          : roleChanged
            ? "Review role change"
            : "Save changes";
  const submitFromGuard = () => {
    afterSave.current = exit;
    setExit(null);
    requestAnimationFrame(() => form.current?.requestSubmit());
  };

  return (
    <Dialog
      title="Manage account"
      close={() => requestExit("close")}
      busy={busy}
      variant="inspector"
    >
      <div className="admin-inspector">
        <header className="admin-identity">
          <div className="admin-person">
            <strong>{displayName}</strong>
            {identity.name ? (
              <span className="admin-caption">
                {identity.email || identity.subject}
              </span>
            ) : null}
          </div>
          <div className="admin-identity-status">
            <span
              className={`admin-availability${accountStatus !== "Active" ? " is-unavailable" : ""}`}
            >
              {accountStatus}
            </span>
            <span className={`admin-badge admin-grant-${state.account.access}`}>
              {accessName[state.account.access]}
              {state.account.access !== "default" ? " grant" : " access"}
            </span>
            {state.account.role === "system_admin" ? (
              <span className="admin-person-role">
                <ShieldCheck size={13} aria-hidden="true" />
                System admin
              </span>
            ) : null}
          </div>
          <div className="admin-support-actions">
            {identity.email ? (
              <a
                className="text-button"
                href={`mailto:${encodeURIComponent(identity.email)}?subject=Grove%20support`}
              >
                <Mail size={14} aria-hidden="true" />
                Email user
              </a>
            ) : null}
            <button
              className="text-button"
              type="button"
              onClick={() => void copy("Account ID", state.account.accountId)}
            >
              <Copy size={14} aria-hidden="true" />
              Copy account ID
            </button>
          </div>
        </header>
        <div
          className="admin-tabs"
          ref={navigation}
          role="group"
          aria-label="Account sections"
        >
          {(["usage", "account", "access"] as const).map((value) => (
            <button
              key={value}
              className="text-button"
              type="button"
              aria-pressed={section === value}
              disabled={busy}
              onClick={() => requestExit(value)}
            >
              {value === "usage"
                ? "Usage"
                : value === "account"
                  ? "Account"
                  : "Access"}
              {section === value && dirty ? (
                <span
                  className="admin-unsaved-dot"
                  aria-label="Unsaved changes"
                />
              ) : null}
            </button>
          ))}
        </div>
        <div className="admin-workspace-content">
          {refreshError ? (
            <div className="admin-error" role="alert">
              <p>
                Couldn’t refresh account details. Your current view and unsaved
                changes are still here.
              </p>
              <button className="text-button" onClick={refresh}>
                Try refreshing details again
              </button>
            </div>
          ) : null}
          {feedback ? (
            <p role="status" className="admin-inline-feedback">
              {feedback}
            </p>
          ) : null}
          {copyFallback ? (
            <label className="admin-copy-fallback">
              {copyFallback.label}
              <textarea
                readOnly
                rows={3}
                value={copyFallback.value}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          ) : null}
          {section === "usage" ? (
            <AccountUsage
              state={state}
              history={history}
              copy={() =>
                void copy(
                  "Usage summary",
                  JSON.stringify(
                    {
                      accountId: state.account.accountId,
                      status: state.account.status,
                      access: state.account.access,
                      counts: state.counts,
                      usage: state.usage,
                    },
                    null,
                    2,
                  ),
                )
              }
            />
          ) : (
            <form
              id="admin-edit-form"
              ref={form}
              className="admin-editor"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {section === "account" ? (
                <>
                  <fieldset className="admin-setting-options" disabled={locked}>
                    <legend>Connected agents</legend>
                    {(["captureEnabled", "recallEnabled"] as const).map(
                      (key) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={draft.settings[key]}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                settings: {
                                  ...draft.settings,
                                  [key]: event.target.checked,
                                },
                              })
                            }
                          />
                          <span>
                            {key === "captureEnabled"
                              ? "Automatic capture"
                              : "Automatic recall"}
                            <span className="admin-caption">
                              {key === "captureEnabled"
                                ? "Allow connected agents to save automatically."
                                : "Allow saved context to be recalled automatically."}
                            </span>
                          </span>
                        </label>
                      ),
                    )}
                  </fieldset>
                  <label>
                    Support note
                    <textarea
                      aria-label="Support note"
                      aria-describedby="admin-support-note-help"
                      rows={3}
                      maxLength={500}
                      disabled={locked}
                      value={draft.settings.supportNote}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          settings: {
                            ...draft.settings,
                            supportNote: event.target.value,
                          },
                        })
                      }
                      placeholder="A short reminder for your next follow-up"
                    />
                    <span
                      id="admin-support-note-help"
                      className="admin-caption"
                    >
                      Only administrators can see this. Don’t store passwords or
                      private note content.
                    </span>
                  </label>
                  <section
                    className="admin-account-availability"
                    aria-labelledby="admin-availability-heading"
                  >
                    <div>
                      <h3 id="admin-availability-heading">
                        Account availability
                      </h3>
                      <p className="admin-caption">
                        {state.settings.suspended
                          ? "Suspended by an administrator. Notes are retained."
                          : state.account.status === "active"
                            ? "This person can use Grove."
                            : "Check the sign-in provider for separate account restrictions."}
                      </p>
                    </div>
                    <button
                      className="app-button secondary"
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          settings: {
                            ...draft.settings,
                            suspended: !draft.settings.suspended,
                          },
                        })
                      }
                    >
                      {availabilityChanged
                        ? "Cancel availability change"
                        : state.settings.suspended
                          ? "Restore account…"
                          : "Suspend account…"}
                    </button>
                    {availabilityChanged ? (
                      <p className="admin-warning">
                        <AlertTriangle size={16} aria-hidden="true" />
                        {draft.settings.suspended
                          ? "Grove and connected-agent access will be blocked. Notes are retained; subscriptions won’t be canceled."
                          : "Grove access will be restored. Separate sign-in provider restrictions won’t be removed."}
                      </p>
                    ) : null}
                  </section>
                  <details className="admin-identifiers">
                    <summary>Account details</summary>
                    <p className="admin-caption">
                      Joined{" "}
                      {new Date(state.account.createdAt).toLocaleDateString()}
                    </p>
                    <label>
                      Account ID
                      <input readOnly value={state.account.accountId} />
                    </label>
                    <label>
                      User ID
                      <input readOnly value={state.account.subject} />
                    </label>
                    <p className="admin-caption">
                      Sign-in details and passwords are managed by the sign-in
                      provider.
                    </p>
                  </details>
                </>
              ) : (
                <>
                  <fieldset disabled={locked}>
                    <legend>Access grant</legend>
                    <div className="admin-options">
                      {(["default", "pro", "unlimited"] as const).map(
                        (value) => (
                          <label key={value}>
                            <input
                              type="radio"
                              name="access"
                              value={value}
                              checked={draft.access === value}
                              onChange={() =>
                                setDraft({ ...draft, access: value })
                              }
                            />
                            <span>{accessName[value]}</span>
                          </label>
                        ),
                      )}
                    </div>
                    <p className="admin-caption">
                      {draft.access === "default"
                        ? "No override. Uses their subscription or Free plan."
                        : draft.access === "pro"
                          ? "Complimentary Pro allowances. No payment required."
                          : "No plan quotas. Shared safety limits still apply."}
                    </p>
                  </fieldset>
                  <div className="admin-role-section">
                    <label>
                      System role
                      <select
                        value={draft.role}
                        disabled={locked}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            role: event.target.value as SystemRole,
                          })
                        }
                      >
                        <option value="user">User</option>
                        <option value="system_admin">System admin</option>
                      </select>
                    </label>
                    <p className="admin-caption">
                      Independent of their plan. System admins manage accounts
                      and access, not other people’s private notes.
                    </p>
                    {roleChanged ? (
                      <p className="admin-warning">
                        <ShieldCheck size={16} aria-hidden="true" />
                        {draft.role === "system_admin"
                          ? "This person will be able to manage other accounts and administrators."
                          : "This person will lose administration access."}
                      </p>
                    ) : null}
                  </div>
                  <p className="admin-caption">
                    Access grants don’t create, change or cancel a subscription.
                  </p>
                  {state.account.status !== "active" ? (
                    <p className="admin-warning">
                      Restore this account before changing access. Provider
                      restrictions must also be cleared.
                    </p>
                  ) : null}
                </>
              )}
              <label>
                Reason for change
                <textarea
                  aria-label="Reason for change"
                  aria-describedby="admin-change-reason-help"
                  required
                  minLength={3}
                  maxLength={300}
                  rows={2}
                  value={reason}
                  disabled={locked}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="A short explanation for the change history"
                />
                <span id="admin-change-reason-help" className="admin-caption">
                  Required for the audit history. At least 3 characters.
                </span>
              </label>
            </form>
          )}
          {error ? (
            <div className="admin-error" role="alert">
              <p>{error}</p>
              {phase === "conflict" && !latest ? (
                <button
                  className="text-button"
                  onClick={() => void reviewLatest()}
                >
                  Review latest account
                </button>
              ) : null}
            </div>
          ) : null}
          {latest ? (
            <div
              className="admin-conflict-review"
              ref={comparison}
              tabIndex={-1}
            >
              <h3>Compare before saving again</h3>
              <div>
                <section>
                  <h4>Latest saved account</h4>
                  <DraftSummary draft={draftFrom(latest)} section={section} />
                </section>
                <section>
                  <h4>Your attempted changes</h4>
                  <DraftSummary draft={draft} section={section} />
                </section>
              </div>
              <div className="admin-editor-actions">
                <button
                  className="app-button secondary"
                  onClick={() => {
                    reset(latest);
                    focusSection();
                  }}
                >
                  Use saved values
                </button>
                <button
                  className="app-button secondary"
                  onClick={keepForReview}
                >
                  Keep my changes for review
                </button>
              </div>
              <p className="admin-caption">
                Nothing is saved by reviewing. Only fields you changed are
                carried forward.
              </p>
            </div>
          ) : null}
        </div>
        {section !== "usage" ? (
          <footer className="admin-editor-actions admin-save-row">
            <span role="status">
              {busy
                ? phase === "reviewing"
                  ? "Loading latest account…"
                  : "Saving changes…"
                : phase === "uncertain"
                  ? "Awaiting confirmation"
                  : dirty
                    ? "Unsaved changes"
                    : "No unsaved changes"}
            </span>
            <div>
              <button
                className="app-button secondary"
                type="button"
                disabled={!dirty || busy || phase === "uncertain"}
                onClick={() => setExit(section)}
              >
                Discard
              </button>
              <button
                className="app-button"
                type="submit"
                form="admin-edit-form"
                disabled={
                  busy ||
                  phase === "conflict" ||
                  (!canSave && phase !== "uncertain") ||
                  (section === "access" && state.account.status !== "active")
                }
              >
                {actionLabel}
              </button>
            </div>
          </footer>
        ) : null}
      </div>
      {exit ? (
        <Dialog
          title={
            phase === "uncertain" ? "Change not confirmed" : "Unsaved changes"
          }
          close={() => {
            setExit(null);
            afterSave.current = null;
          }}
        >
          <div className="admin-exit-review">
            <p>
              {phase === "uncertain"
                ? "The request may already have been saved. Retry the same change to confirm its result before leaving."
                : "Save your changes or discard them before leaving this section."}
            </p>
            <div className="admin-editor-actions">
              <button
                className="app-button secondary"
                onClick={() => {
                  setExit(null);
                  afterSave.current = null;
                }}
              >
                Keep editing
              </button>
              {phase !== "uncertain" ? (
                <button className="app-button secondary" onClick={discard}>
                  Discard changes
                </button>
              ) : null}
              <button
                className="app-button"
                disabled={
                  phase !== "uncertain" && (!canSave || phase === "conflict")
                }
                onClick={submitFromGuard}
              >
                {phase === "uncertain" ? "Retry same change" : "Save changes"}
              </button>
            </div>
            {phase !== "uncertain" && !canSave ? (
              <p className="admin-caption">
                Return to the form to add a reason before saving.
              </p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      {confirm ? (
        <Dialog
          title={
            availabilityChanged
              ? draft.settings.suspended
                ? "Suspend this account?"
                : "Restore this account?"
              : "Change system role?"
          }
          close={() => {
            setConfirm(false);
            afterSave.current = null;
          }}
        >
          <div className="admin-exit-review">
            <p>
              <strong>{displayName}</strong>
            </p>
            <DraftSummary
              draft={draft}
              section={section}
              before={draftFrom(state)}
            />
            <p>
              {availabilityChanged
                ? draft.settings.suspended
                  ? "This blocks Grove and connected-agent access, retains notes and does not cancel subscriptions."
                  : "This restores Grove access but does not remove sign-in provider restrictions."
                : "System administrators can manage other accounts and administrators. This does not grant access to private notes."}
            </p>
            <p className="admin-caption">Reason: {reason.trim()}</p>
            <div className="admin-editor-actions">
              <button
                className="app-button secondary"
                onClick={() => {
                  setConfirm(false);
                  afterSave.current = null;
                }}
              >
                Keep editing
              </button>
              <button
                className="app-button"
                onClick={() => {
                  setConfirm(false);
                  void save();
                }}
              >
                {availabilityChanged
                  ? draft.settings.suspended
                    ? "Confirm suspension"
                    : "Confirm restoration"
                  : "Confirm role change"}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

function DraftSummary({
  draft,
  section,
  before,
}: {
  draft: Draft;
  section: Section;
  before?: Draft;
}) {
  return (
    <dl className="admin-draft-summary">
      {section === "access" ? (
        <>
          {!before || draft.access !== before.access ? (
            <div>
              <dt>Access grant</dt>
              <dd>{accessName[draft.access]}</dd>
            </div>
          ) : null}
          {!before || draft.role !== before.role ? (
            <div>
              <dt>System role</dt>
              <dd>{roleName[draft.role]}</dd>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {!before ||
          draft.settings.captureEnabled !== before.settings.captureEnabled ? (
            <div>
              <dt>Automatic capture</dt>
              <dd>{draft.settings.captureEnabled ? "On" : "Off"}</dd>
            </div>
          ) : null}
          {!before ||
          draft.settings.recallEnabled !== before.settings.recallEnabled ? (
            <div>
              <dt>Automatic recall</dt>
              <dd>{draft.settings.recallEnabled ? "On" : "Off"}</dd>
            </div>
          ) : null}
          {!before || draft.settings.suspended !== before.settings.suspended ? (
            <div>
              <dt>Suspension</dt>
              <dd>
                {draft.settings.suspended ? "Suspended" : "Not suspended"}
              </dd>
            </div>
          ) : null}
          {!before ||
          draft.settings.supportNote !== before.settings.supportNote ? (
            <div>
              <dt>Support note</dt>
              <dd>{draft.settings.supportNote || "None"}</dd>
            </div>
          ) : null}
        </>
      )}
    </dl>
  );
}

function AccountUsage({
  state,
  history,
  copy,
}: {
  state: AdminDetails;
  history: AdminAudit[];
  copy: () => void;
}) {
  return (
    <section className="admin-detail-section" aria-label="Account usage">
      <div className="admin-section-heading">
        <h3>Current library</h3>
        <button className="text-button" onClick={copy}>
          <Copy size={14} aria-hidden="true" />
          Copy usage summary
        </button>
      </div>
      <dl className="admin-counts">
        {(["notes", "notebooks", "connections"] as const).map((key) => (
          <div key={key}>
            <dt>
              {key === "notes"
                ? "Notes"
                : key === "notebooks"
                  ? "Notebooks"
                  : "Connections"}
            </dt>
            <dd>{state.counts[key].toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <table className="admin-usage">
        <caption>AI & speech usage</caption>
        <thead>
          <tr>
            <th scope="col">Activity</th>
            <th scope="col">Today</th>
            <th scope="col">This month</th>
          </tr>
        </thead>
        <tbody>
          {(
            ["generation", "research", "transcription", "synthesis"] as const
          ).map((metric) => {
            const timed = metric === "transcription" || metric === "synthesis";
            const format = (value: number) =>
              new Intl.NumberFormat(undefined, {
                maximumFractionDigits: timed ? 2 : 0,
              }).format(timed ? value / 60000 : value);
            return (
              <tr key={metric}>
                <th scope="row">
                  {
                    {
                      generation: "AI requests",
                      research: "Web research",
                      transcription: "Transcription",
                      synthesis: "Read aloud",
                    }[metric]
                  }
                  <span className="admin-caption">
                    {timed ? "Minutes" : "Requests"}
                  </span>
                </th>
                <td>{format(state.usage.metrics[metric].today)}</td>
                <td>{format(state.usage.metrics[metric].month)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="admin-caption">
        UTC calendar periods. Operational counters include reserved and failed
        attempts; they aren’t invoices. Cached audio isn’t counted again.
      </p>
      <details className="admin-period-details">
        <summary>When usage resets</summary>
        <p className="admin-caption">
          Daily: {shortDate(state.usage.dailyResetAt)}. Monthly:{" "}
          {shortDate(state.usage.monthlyResetAt)}. Times shown in your local
          time zone.
        </p>
      </details>
      <details className="admin-history">
        <summary>Recent account changes</summary>
        <p className="admin-caption">
          Matching entries from the latest 50 administration changes.
        </p>
        <AdminHistory entries={history} accountOnly />
      </details>
    </section>
  );
}
