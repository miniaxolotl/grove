"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  agentNames,
  capabilities,
  type ConnectAttempt,
  type ConnectApproval,
} from "@lib/shared/contracts";
import {
  api,
  DashboardApiError,
  errorMessage,
  type Project,
} from "@/lib/dashboard-api";
import { CodeBlock } from "@/components/code-block";
import { LoadError } from "./load-error";

export function ConnectAgent({ id }: { id: string }) {
  const [attempt, setAttempt] = useState<ConnectAttempt | null>(null);
  const [error, setError] = useState("");
  const [accountHint, setAccountHint] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<ConnectAttempt>(
      `/connect/${id}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then(setAttempt)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(e));
          setAccountHint(
            e instanceof DashboardApiError &&
              e.code === "connection_unavailable",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => {
    if (attempt?.status !== "pending" || error) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    const interval = Math.min(
      4000,
      Math.max(1000, Date.parse(attempt.expiresAt) - Date.now()),
    );
    async function refresh() {
      if (busy || controller.signal.aborted) return;
      busy = true;
      clearTimeout(timer);
      try {
        const latest = await api<ConnectAttempt>(
          `/connect/${id}`,
          undefined,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setAttempt((current) =>
          current?.status === "pending" ? latest : current,
        );
        setStatusError("");
      } catch (e) {
        if (controller.signal.aborted) return;
        if (
          e instanceof DashboardApiError &&
          e.status < 500 &&
          e.status !== 429
        )
          setError(errorMessage(e));
        else
          setStatusError(
            "Reconnecting to Grove… Your choices are kept while we check your connection.",
          );
      } finally {
        busy = false;
        if (!controller.signal.aborted) timer = setTimeout(refresh, interval);
      }
    }
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    timer = setTimeout(refresh, interval);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id, attempt?.status, attempt?.expiresAt, error]);
  return (
    <div className="mx-auto max-w-xl">
      <div className="app-page-heading connect-page-heading">
        <div>
          <h1>
            {attempt
              ? `Connect ${agentNames[attempt.agent]}`
              : "Connect your agent"}
            <span className="text-leaf">.</span>
          </h1>
          <p>Approve access. Grove finishes setup in your terminal.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Loading your connection…</p>
      ) : error ? (
        <>
          <LoadError
            message={error}
            retry={() => {
              setLoading(true);
              setError("");
              setRevision((n) => n + 1);
            }}
          />
          {accountHint && (
            <p className="mt-4 text-sm text-muted">
              Use the same Grove account as your terminal. You can switch
              accounts from the account menu, then reopen this link.
            </p>
          )}
        </>
      ) : attempt?.status === "pending" ? (
        <>
          {statusError && (
            <p role="status" className="mb-3 text-sm text-muted">
              {statusError}
            </p>
          )}
          <ApprovalForm key={attempt.id} attempt={attempt} done={setAttempt} />
        </>
      ) : (
        attempt && (
          <section className="app-panel" aria-live="polite">
            {attempt.status === "approved" ? (
              <>
                <Check className="mb-4 text-leaf" aria-hidden="true" />
                <h2 className="font-editorial text-3xl">
                  Access approved. Back to your terminal.
                </h2>
                <p className="mt-4 text-sm leading-7 text-muted">
                  Grove will finish configuring {agentNames[attempt.agent]}{" "}
                  automatically. Your terminal will tell you how to load its
                  tools.
                </p>
                <p className="mt-3 text-sm leading-7 text-muted">
                  If you closed the terminal, run the same connect command again
                  to finish setup.
                </p>
                {attempt.grant.capabilities.includes("memory:write") && (
                  <div className="mt-5">
                    <CodeBlock
                      title="Try your first memory"
                      code={
                        attempt.grant.personal
                          ? "Use Grove to remember that I prefer concise answers in my personal memories."
                          : "Use Grove to save a confirmed decision in an allowed project."
                      }
                      light
                    />
                  </div>
                )}
                <Link
                  className="app-button secondary mt-6"
                  href="/app/settings/connections"
                >
                  Manage connections
                </Link>
              </>
            ) : (
              <>
                <h2 className="font-editorial text-3xl">
                  Connection {attempt.status}.
                </h2>
                <p className="mt-4 text-sm leading-7 text-muted">
                  This request did not change your access. Run the same connect
                  command again when you are ready.
                </p>
                <Link className="app-button secondary mt-6" href="/install">
                  Connection instructions
                </Link>
              </>
            )}
          </section>
        )
      )}
    </div>
  );
}

function ApprovalForm({
  attempt,
  done,
}: {
  attempt: ConnectAttempt;
  done: (value: ConnectAttempt) => void;
}) {
  const [grant, setGrant] = useState<ConnectApproval>({
    ...attempt.grant,
    currentProject: !!attempt.project,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectRevision, setProjectRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<Project[]>("/projects", undefined, undefined, controller.signal)
      .then(setProjects)
      .catch((e) => {
        if (!controller.signal.aborted) setProjectsError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [projectRevision]);
  async function submit(action: "approve" | "cancel") {
    setBusy(true);
    setError("");
    try {
      done(
        await api<ConnectAttempt>(
          `/connect/${attempt.id}/${action}`,
          action === "approve" ? grant : {},
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    "memory:read": "Read memories",
    "memory:write": "Save and update memories",
    "memory:delete": "Delete memories",
  };
  return (
    <form
      className="app-panel app-form connect-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("approve");
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-3 text-xs font-medium">Memory access</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={grant.personal}
            onChange={(e) => setGrant({ ...grant, personal: e.target.checked })}
          />
          Personal memories
        </label>
        {attempt.project && (
          <div>
            <label className="check">
              <input
                type="checkbox"
                checked={grant.currentProject || grant.allProjects}
                disabled={grant.allProjects}
                onChange={(e) =>
                  setGrant({ ...grant, currentProject: e.target.checked })
                }
              />
              This project: {attempt.project.name}
            </label>
            <p className="mt-2 break-all text-xs text-muted">
              {attempt.project.identity}
            </p>
          </div>
        )}
        {!attempt.project && (
          <p className="text-xs leading-6 text-muted">
            No Git project was detected. Run connect from a repository to add
            project access later.
          </p>
        )}
      </fieldset>
      <div
        className="rounded-lg bg-sage/50 p-4 text-sm leading-7"
        aria-label="Permission summary"
      >
        {grant.capabilities.map((capability) => (
          <p key={capability}>{labels[capability]}</p>
        ))}
        {grant.allProjects && <p>All current and future projects</p>}
        {grant.projectIds.length > 0 && (
          <p>{grant.projectIds.length} previously selected project(s)</p>
        )}
        {grant.expiresAt && (
          <p>Expires {new Date(grant.expiresAt).toLocaleDateString()}</p>
        )}
      </div>
      <details>
        <summary className="cursor-pointer py-3 text-sm font-medium text-leaf">
          Customize access
        </summary>
        <div className="mt-4 space-y-5">
          <label>
            Connection name
            <input
              required
              maxLength={100}
              value={grant.name}
              onChange={(e) => setGrant({ ...grant, name: e.target.value })}
            />
          </label>
          <fieldset className="space-y-3">
            <legend className="mb-3 text-xs font-medium">Actions</legend>
            {capabilities.map((capability) => (
              <label className="check" key={capability}>
                <input
                  type="checkbox"
                  checked={grant.capabilities.includes(capability)}
                  onChange={(e) =>
                    setGrant({
                      ...grant,
                      capabilities: e.target.checked
                        ? [...grant.capabilities, capability]
                        : grant.capabilities.filter((c) => c !== capability),
                    })
                  }
                />
                {labels[capability]}
              </label>
            ))}
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={grant.allProjects}
              onChange={(e) =>
                setGrant({ ...grant, allProjects: e.target.checked })
              }
            />
            All current and future projects
          </label>
          {!grant.allProjects && projectsLoading && (
            <p role="status" className="text-sm text-muted">
              Loading other projects…
            </p>
          )}
          {projectsError && (
            <LoadError
              message={projectsError}
              retry={() => {
                setProjectsError("");
                setProjectsLoading(true);
                setProjectRevision((n) => n + 1);
              }}
            />
          )}
          {!grant.allProjects &&
            projects
              .filter((p) => p.identity !== attempt.project?.identity)
              .map((p) => (
                <label className="check" key={p.id}>
                  <input
                    type="checkbox"
                    checked={grant.projectIds.includes(p.id)}
                    onChange={(e) =>
                      setGrant({
                        ...grant,
                        projectIds: e.target.checked
                          ? [...grant.projectIds, p.id]
                          : grant.projectIds.filter((id) => id !== p.id),
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
          <label>
            Expiry (optional)
            <input
              type="date"
              value={grant.expiresAt?.slice(0, 10) ?? ""}
              onChange={(e) =>
                setGrant({
                  ...grant,
                  expiresAt: e.target.value
                    ? new Date(`${e.target.value}T23:59:59Z`).toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <p className="break-all text-xs text-muted">
            OAuth client: {attempt.clientId}
          </p>
        </div>
      </details>
      {error && (
        <p role="alert" className="app-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className="app-button"
          disabled={
            busy ||
            !grant.capabilities.length ||
            (!grant.personal &&
              !grant.currentProject &&
              !grant.allProjects &&
              !grant.projectIds.length)
          }
        >
          {busy ? "Connecting…" : `Connect ${agentNames[attempt.agent]}`}
        </button>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => void submit("cancel")}
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-muted">
        You can change or revoke access at any time.
      </p>
    </form>
  );
}
