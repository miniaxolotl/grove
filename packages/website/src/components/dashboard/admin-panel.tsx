"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RotateCw } from "lucide-react";
import type {
  AccessGrant,
  AdminAccount,
  AdminAudit,
  AdminChange,
  AdminUser,
  SystemRole,
} from "@lib/shared/system-admin";
import { DashboardApiError } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { Dialog } from "./dialog";
import "./admin-panel.css";

const accessName: Record<AccessGrant, string> = {
  default: "Standard",
  pro: "Pro",
  unlimited: "Unlimited",
};
const roleName: Record<SystemRole, string> = {
  user: "User",
  system_admin: "System admin",
};
const denied = (error: unknown) =>
  error instanceof DashboardApiError && [401, 403].includes(error.status);
const shortDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function AdminPanel() {
  const cache = useWorkspaceCache();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [feedback, setFeedback] = useState("");
  const status = useQuery({
    ...cache.resource<{ role: SystemRole }>("/admin"),
    staleTime: 0,
    refetchInterval: 60000,
  });
  const authorized = status.data?.role === "system_admin" && !status.error;
  const accounts = useQuery({
    queryKey: ["admin-accounts", search],
    queryFn: ({ signal }) =>
      cache.api<AdminUser[]>(
        "/admin/accounts/search",
        { query: search },
        "POST",
        signal,
      ),
    enabled: authorized,
    staleTime: 0,
    refetchInterval: 60000,
    retry: false,
  });
  const audit = useQuery({
    ...cache.resource<AdminAudit[]>("/admin/audit"),
    enabled: authorized,
    staleTime: 0,
    refetchInterval: 60000,
    retry: false,
  });
  const lostAccess =
    denied(status.error) || denied(accounts.error) || denied(audit.error);
  if (lostAccess || status.data?.role === "user")
    return (
      <div className="admin-sheet">
        <h2 className="settings-section-heading">Administration</h2>
        <p>System administrator access is required.</p>
      </div>
    );
  if (!authorized)
    return (
      <div className="admin-sheet">
        <h2 className="settings-section-heading">Administration</h2>
        <p role="status">
          {status.isPending
            ? "Checking access…"
            : "Couldn’t check your access."}
        </p>
        {!status.isPending ? (
          <button className="text-button" onClick={() => void status.refetch()}>
            Try again
          </button>
        ) : null}
      </div>
    );
  return (
    <div className="admin-sheet">
      <header className="admin-heading">
        <div>
          <h2 className="settings-section-heading">Administration</h2>
          <p className="admin-caption">Manage people and their access.</p>
        </div>
        <button
          className="app-icon"
          aria-label="Refresh accounts"
          disabled={accounts.isFetching}
          onClick={() => {
            void accounts.refetch();
            void audit.refetch();
          }}
        >
          <RotateCw size={16} aria-hidden="true" />
        </button>
      </header>
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(input.trim());
          setFeedback("");
        }}
      >
        <label htmlFor="admin-search">Find a person</label>
        <div>
          <input
            id="admin-search"
            type="search"
            autoComplete="off"
            placeholder="Exact email or user ID"
            maxLength={254}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="app-button secondary" type="submit">
            <Search size={16} aria-hidden="true" />
            Search
          </button>
        </div>
      </form>
      <p className="admin-feedback" role="status">
        {feedback ||
          (accounts.isFetching
            ? "Loading accounts…"
            : search
              ? "Search results"
              : "Recent accounts")}
      </p>
      {accounts.error ? (
        <div role="alert" className="admin-error">
          <p>
            {accounts.error instanceof DashboardApiError &&
            accounts.error.status === 400
              ? "Use an exact email address or user ID."
              : "Couldn’t load accounts."}
          </p>
          <button
            className="text-button"
            onClick={() => void accounts.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <ul className="admin-accounts" aria-label="Accounts">
          {accounts.data?.map((account) => (
            <li key={account.accountId}>
              <div className="admin-person">
                <strong>
                  {account.name || account.email || account.subject}
                </strong>
                <span className="admin-caption">
                  {account.email || account.subject}
                </span>
              </div>
              <div className="admin-access">
                <span className="admin-badge">
                  {accessName[account.access]}
                </span>
                {account.role === "system_admin" ? (
                  <span className="admin-caption">System admin</span>
                ) : null}
                {account.status !== "active" ? (
                  <span className="admin-caption">Unavailable</span>
                ) : null}
              </div>
              <button
                className="text-button"
                data-focus-key={`admin-${account.accountId}`}
                aria-label={`Manage ${account.email || account.subject}`}
                disabled={account.status !== "active"}
                onClick={() => setSelected(account)}
              >
                Manage
              </button>
            </li>
          ))}
        </ul>
      )}
      {accounts.data?.length === 0 && !accounts.error ? (
        <p className="admin-caption">
          No Grove accounts found. They’ll appear after signing in to Grove.
        </p>
      ) : null}
      <section
        className="admin-history"
        aria-labelledby="admin-history-heading"
      >
        <h3 id="admin-history-heading">Recent changes</h3>
        {audit.error ? (
          <div role="alert">
            <p>Couldn’t load recent changes.</p>
            <button
              className="text-button"
              onClick={() => void audit.refetch()}
            >
              Try again
            </button>
          </div>
        ) : (
          <ol>
            {audit.data?.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.after.subject}</strong>
                  <span className="admin-caption">
                    {roleName[entry.after.role]} ·{" "}
                    {accessName[entry.after.access]}
                  </span>
                </div>
                <p>{entry.reason}</p>
                <div className="admin-caption">
                  <time dateTime={entry.createdAt}>
                    {shortDate(entry.createdAt)}
                  </time>
                  <span>
                    By{" "}
                    {entry.actorId
                      ? entry.before.accountId === entry.actorId
                        ? entry.before.subject
                        : entry.actorId
                      : "Owner setup"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
        {audit.data?.length === 0 ? (
          <p className="admin-caption">Access changes will appear here.</p>
        ) : null}
      </section>
      {selected ? (
        <AccessEditor
          key={`${selected.accountId}:${selected.version}`}
          account={selected}
          close={() => setSelected(null)}
          saved={(updated) => {
            cache.client.setQueryData<AdminUser[]>(
              ["admin-accounts", search],
              (rows) =>
                rows?.map((row) =>
                  row.accountId === updated.accountId
                    ? { ...row, ...updated }
                    : row,
                ),
            );
            setSelected(null);
            setFeedback("Access updated.");
            void accounts.refetch();
            void audit.refetch();
            void status.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function AccessEditor({
  account,
  close,
  saved,
}: {
  account: AdminUser;
  close: () => void;
  saved: (account: AdminAccount) => void;
}) {
  const cache = useWorkspaceCache();
  const [access, setAccess] = useState(account.access);
  const [role, setRole] = useState(account.role);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const operation = useRef<AdminChange | null>(null);
  const pending = useRef(false);
  const changed = access !== account.access || role !== account.role;
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const body = (operation.current ??= {
      accountId: account.accountId,
      operationId: crypto.randomUUID(),
      expectedVersion: account.version,
      role,
      access,
      reason: reason.trim(),
    });
    try {
      saved(await cache.api<AdminAccount>("/admin/accounts", body, "PATCH"));
    } catch (failure) {
      if (failure instanceof DashboardApiError && failure.status < 500) {
        setConflict(true);
        setUncertain(false);
        setError(
          failure.code === "last_system_admin"
            ? "Keep at least one active system admin."
            : failure.status === 403
              ? "Your admin access has ended."
              : "This account changed. Close and refresh before trying again.",
        );
      } else {
        setUncertain(true);
        setError(
          "Couldn’t confirm the change. Try again to check and save it safely.",
        );
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog title="Manage access" close={close} busy={busy} variant="inspector">
      <form
        className="inspector-body admin-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="admin-person">
          <strong>{account.name || account.email || account.subject}</strong>
          <span className="admin-caption">
            {account.email || account.subject}
          </span>
        </div>
        <fieldset disabled={busy || uncertain || conflict}>
          <legend>Access</legend>
          <div className="admin-options">
            {(["default", "pro", "unlimited"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="access"
                  value={value}
                  checked={access === value}
                  onChange={() => setAccess(value)}
                />
                <span>{accessName[value]}</span>
              </label>
            ))}
          </div>
          <p className="admin-caption">
            {access === "default"
              ? "Uses their subscription or Free plan."
              : access === "pro"
                ? "Complimentary Pro allowances. No payment required."
                : "No plan quotas. Shared safety limits still apply."}
          </p>
        </fieldset>
        <label>
          System role
          <select
            value={role}
            disabled={busy || uncertain || conflict}
            onChange={(event) => setRole(event.target.value as SystemRole)}
          >
            <option value="user">User</option>
            <option value="system_admin">System admin</option>
          </select>
        </label>
        {role !== account.role ? (
          <p className="admin-role-warning">
            {role === "system_admin"
              ? "System admins can grant access and manage other admins."
              : "This person will lose administration access."}
          </p>
        ) : null}
        <label>
          Reason
          <textarea
            required
            minLength={3}
            maxLength={300}
            rows={2}
            value={reason}
            disabled={busy || uncertain || conflict}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you changing their access?"
          />
        </label>
        <p className="admin-caption">
          Existing subscriptions won’t be changed or canceled.
        </p>
        {error ? (
          <p role="alert" className="admin-error">
            {error}
          </p>
        ) : null}
        <div className="admin-editor-actions">
          <button
            className="app-button secondary"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="app-button"
            type="submit"
            disabled={busy || conflict || !changed || reason.trim().length < 3}
          >
            {busy ? "Saving…" : uncertain ? "Try again" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
