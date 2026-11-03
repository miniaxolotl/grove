"use client";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, RotateCw, X, ShieldCheck } from "lucide-react";
import type {
  AdminAudit,
  AdminPage,
  AdminUser,
  SystemRole,
} from "@lib/shared/system-admin";
import { DashboardApiError } from "@/lib/dashboard-api";
import { useWorkspaceCache } from "./workspace-cache";
import { AccountInspector, adminDenied } from "./admin-account-inspector";
import { accessName, AdminHistory } from "./admin-history";
import "./admin-panel.css";
import { deferredFeature } from "./deferred-feature";

const UsageReports = deferredFeature(
  async () => ({
    default: (await import("./admin-usage-reports")).AdminUsageReports,
  }),
  "Loading usage reports…",
);

export function AdminPanel() {
  const cache = useWorkspaceCache();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [detailDenied, setDetailDenied] = useState(false);
  const [section, setSection] = useState<"people" | "usage">("people");
  const status = useQuery({
    ...cache.resource<{ role: SystemRole }>("/admin"),
    staleTime: 0,
    refetchInterval: 60000,
  });
  // A transient refresh failure must not unmount an operator's unsaved draft.
  // Mutations still independently check current authority on the server.
  const authorized =
    status.data?.role === "system_admin" && !adminDenied(status.error);
  const accounts = useQuery({
    queryKey: ["admin-accounts", search],
    queryFn: ({ signal }) =>
      cache.api<AdminUser[]>(
        "/admin/accounts/search",
        { query: search },
        "POST",
        signal,
      ),
    enabled: authorized && section === "people" && !!search,
    staleTime: 0,
    refetchInterval: 60000,
    retry: false,
  });
  const browse = useInfiniteQuery({
    queryKey: ["admin-browse"],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      cache.api<AdminPage<AdminUser>>(
        "/admin/accounts/browse",
        pageParam ? { after: pageParam } : {},
        "POST",
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: authorized && section === "people" && !search,
    staleTime: 0,
    retry: false,
  });
  const audit = useQuery({
    ...cache.resource<AdminAudit[]>("/admin/audit"),
    enabled: authorized && (section === "people" || !!selected),
    staleTime: 0,
    refetchInterval: 60000,
    retry: false,
  });
  const rows = search
    ? accounts.data
    : browse.data?.pages.flatMap((page) => page.accounts);
  const accountError = search ? accounts.error : browse.error;
  const loading = search ? accounts.isFetching : browse.isFetching;
  const total = browse.data?.pages[0]?.total;
  const refresh = () => {
    if (search) void accounts.refetch();
    else void browse.refetch();
    void audit.refetch();
  };
  const clearSearch = () => {
    setInput("");
    setSearch("");
  };
  const lostAccess =
    detailDenied ||
    [status.error, accounts.error, browse.error, audit.error].some(adminDenied);
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
      <nav className="admin-sections" aria-label="Admin sections">
        <button
          type="button"
          aria-pressed={section === "people"}
          onClick={() => setSection("people")}
        >
          People &amp; access
        </button>
        <button
          type="button"
          aria-pressed={section === "usage"}
          onClick={() => setSection("usage")}
        >
          Usage reports
        </button>
      </nav>
      {section === "usage" ? (
        <UsageReports
          onDenied={() => setDetailDenied(true)}
          onInspect={(user) =>
            setSelected({
              ...user,
              name: user.name ?? null,
              email: user.email ?? null,
            })
          }
        />
      ) : (
        <>
          <header className="admin-heading">
            <div>
              <h2 className="settings-section-heading">People & access</h2>
              <p className="admin-caption">Manage Grove accounts and access.</p>
            </div>
            <button
              className="app-button secondary admin-refresh"
              aria-label="Refresh accounts"
              disabled={loading}
              onClick={refresh}
            >
              <RotateCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </header>
          {status.error ? (
            <div className="admin-error" role="alert">
              <p>
                Couldn’t refresh your admin access. Saved account data is still
                shown.
              </p>
              <button
                className="text-button"
                onClick={() => void status.refetch()}
              >
                Check access again
              </button>
            </div>
          ) : null}
          <form
            className="admin-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(input.trim());
            }}
          >
            <label htmlFor="admin-search">Find a person</label>
            <div>
              <div className="admin-search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  id="admin-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Exact email or user ID"
                  maxLength={254}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
              </div>
              <button className="app-button secondary" type="submit">
                Search
              </button>
              {search ? (
                <button
                  className="app-icon"
                  type="button"
                  aria-label="Clear search"
                  onClick={clearSearch}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </form>
          <div className="admin-list-summary">
            <p role="status">
              {loading
                ? rows
                  ? "Refreshing accounts…"
                  : "Loading accounts…"
                : search
                  ? `${rows?.length ?? 0} search ${rows?.length === 1 ? "result" : "results"}`
                  : `${total ?? "…"} accounts`}
            </p>
            {search ? (
              <button className="text-button" onClick={clearSearch}>
                Show all people
              </button>
            ) : rows?.length ? (
              <span>
                Showing {rows.length} of {total}
              </span>
            ) : null}
          </div>
          {accountError && (search || !browse.isFetchNextPageError) ? (
            <div role="alert" className="admin-error">
              <p>
                {accountError instanceof DashboardApiError &&
                accountError.status === 400
                  ? "Use an exact email address or user ID."
                  : rows
                    ? "Couldn’t refresh accounts. The previous results are still shown."
                    : "Couldn’t load accounts."}
              </p>
              <button className="text-button" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : null}
          {rows?.length ? (
            <div className="admin-directory">
              <div className="admin-directory-labels" aria-hidden="true">
                <span>Person</span>
                <span>Access grant</span>
                <span>Status</span>
                <span />
              </div>
              <ul className="admin-accounts" aria-label="Accounts">
                {rows.map((account) => (
                  <li key={account.accountId}>
                    <div className="admin-person">
                      <strong>
                        {account.name || account.email || account.subject}
                      </strong>
                      {account.name ? (
                        <span className="admin-caption">
                          {account.email || account.subject}
                        </span>
                      ) : null}
                      {account.role === "system_admin" ? (
                        <span className="admin-person-role">
                          <ShieldCheck size={12} aria-hidden="true" />
                          System admin
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={`admin-badge admin-grant-${account.access}`}
                    >
                      {accessName[account.access]}
                    </span>
                    <span
                      className={`admin-availability${account.status !== "active" ? " is-unavailable" : ""}`}
                    >
                      {account.status === "active" ? "Active" : "Unavailable"}
                    </span>
                    <button
                      className="app-button secondary admin-manage"
                      data-focus-key={`admin-${account.accountId}`}
                      aria-label={`Manage ${account.email || account.subject}`}
                      onClick={() => setSelected(account)}
                    >
                      Manage
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!loading && rows?.length === 0 && !accountError ? (
            <div className="admin-empty">
              <h3>
                {search ? "No matching account" : "No Grove accounts yet"}
              </h3>
              <p>
                {search
                  ? "Check the exact email address or user ID. Only people who have signed in to Grove can be found."
                  : "People will appear here after they sign in to Grove."}
              </p>
              {search ? (
                <button className="text-button" onClick={clearSearch}>
                  Show all people
                </button>
              ) : null}
            </div>
          ) : null}
          {!search && browse.hasNextPage ? (
            <button
              className="app-button secondary admin-more"
              disabled={browse.isFetchingNextPage}
              onClick={() => void browse.fetchNextPage()}
            >
              {browse.isFetchingNextPage
                ? "Loading…"
                : browse.isFetchNextPageError
                  ? "Try loading more again"
                  : "Load more people"}
            </button>
          ) : null}
          <details className="admin-history">
            <summary>
              Recent changes <span className="admin-caption">Latest 50</span>
            </summary>
            {audit.error ? (
              <div role="alert">
                <p>Couldn’t refresh recent changes.</p>
                <button
                  className="text-button"
                  onClick={() => void audit.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : null}
            {audit.isPending ? (
              <p role="status">Loading recent changes…</p>
            ) : (
              <AdminHistory entries={audit.data ?? []} />
            )}
          </details>
        </>
      )}
      {selected ? (
        <AccountInspector
          key={selected.accountId}
          account={selected}
          audit={audit.data ?? []}
          accessDenied={() => setDetailDenied(true)}
          close={() => setSelected(null)}
          saved={() => {
            refresh();
            void status.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
