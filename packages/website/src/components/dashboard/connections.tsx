"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { KeyRound, Plug } from "lucide-react";
import {
  capabilities,
  type Grant,
  type ConnectAttempt,
} from "@lib/shared/contracts";
import { errorMessage, type Project } from "@/lib/dashboard-api";
import { useWorkspaceApi, useWorkspaceCache } from "./workspace-cache";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { AgentSetup } from "@/components/installation";
import { Button } from "./ui/button";
import { Disclosure } from "./ui/disclosure";
import { useNotebooks } from "./notebooks-provider";
import { notebookOptions } from "@/lib/notebooks";

type Connection = Grant & {
  id: string;
  clientId: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  setup?: ConnectAttempt | null;
  state?: string;
};
const capabilityLabels = {
  "memory:read": "Read notes",
  "memory:write": "Save and update notes",
  "memory:delete": "Delete notes",
};
export function Connections({ origin }: { origin: string }) {
  const api = useWorkspaceApi();
  const cache = useWorkspaceCache();
  const query = useQuery(cache.resource<Connection[]>("/connections"));
  const [openedAt] = useState(Date.now);
  const items = (query.data ?? []).map((item) =>
    item.setup?.status === "pending" &&
    Date.parse(item.setup.expiresAt) <= Math.max(openedAt, query.dataUpdatedAt)
      ? { ...item, setup: { ...item.setup, status: "expired" as const } }
      : item,
  );
  const { projects } = useNotebooks();
  const loading = query.isPending;
  const [actionError, setError] = useState("");
  const error = actionError || (query.error ? errorMessage(query.error) : "");
  const [selected, setSelected] = useState<Connection | "new" | null>(null);
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const revokeLock = useRef(false);
  const reload = () => {
    setError("");
    setNotice("");
    void query.refetch();
  };
  async function revoke(id: string) {
    if (revokeLock.current) return;
    revokeLock.current = true;
    setRevoking(id);
    try {
      await api(`/connections/${id}`, undefined, "DELETE");
      setError("");
      setNotice(
        "Connection revoked. Future Grove requests are denied; text already delivered to a chat cannot be retracted.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      revokeLock.current = false;
      setRevoking(null);
    }
  }
  return (
    <>
      <h2 className="settings-section-heading">Connections</h2>
      <p className="settings-section-description">
        Choose what each agent can read, remember, and forget.
      </p>
      <details className="connection-setup">
        <summary>
          <Plug size={17} />
          Connect an agent
        </summary>
        <section className="app-panel">
          <div className="flex items-center gap-3">
            <Plug size={20} />
            <h2 className="font-editorial text-2xl">Connect an agent</h2>
          </div>
          <p className="mt-3 text-sm leading-7 text-muted">
            Choose a web chat or coding agent, sign in with OAuth, and approve
            its access. Web chats need no terminal. No key to copy; access can
            be changed or revoked here.
          </p>
          <div className="mt-4">
            <AgentSetup origin={origin || undefined} />
          </div>
        </section>
      </details>
      <Disclosure
        title="Advanced: API keys & headless clients"
        className="connection-advanced"
      >
        <p>
          Use a named, scoped API key for automation or clients that cannot open
          a browser. Both methods use the same memory permissions. Give each
          integration its own key so you can revoke it independently.
        </p>
        <Button variant="secondary" onClick={() => setSelected("new")}>
          <KeyRound size={16} />
          Create API key
        </Button>
        <p>
          For terminal setup, run <code>grove login --key-stdin</code> and
          provide the key through standard input.
        </p>
      </Disclosure>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-6 text-muted">
          Just signed in from your chat? Refresh to find its pending OAuth
          client.
        </p>
        <Button
          variant="secondary"
          onClick={reload}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Refreshing…" : "Refresh connections"}
        </Button>
      </div>
      {notice && (
        <p role="status" className="mb-4 text-sm leading-7">
          {notice}
        </p>
      )}
      {error && <LoadError message={error} retry={reload} />}
      {loading ? (
        <p role="status">Loading connections…</p>
      ) : !items.length && !error ? (
        <div className="app-empty">
          <KeyRound size={28} className="mx-auto mb-4" strokeWidth={1.3} />
          <h2 className="font-editorial text-3xl">
            Your agents are welcome here.
          </h2>
          <p className="mt-3 text-sm text-muted">
            Connect an agent or create a named key to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              id={`connection-${item.id}`}
              className="app-panel connection-grant"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">{item.name}</h2>
                  <p className="mt-2 text-xs text-muted">
                    {item.revokedAt
                      ? "Revoked"
                      : item.expiresAt && new Date(item.expiresAt) < new Date()
                        ? "Expired"
                        : item.capabilities.length
                          ? "Approved"
                          : "Awaiting approval"}{" "}
                    · {item.clientId ? "Browser OAuth" : "API key"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {item.setup?.status === "pending" && !item.revokedAt ? (
                    <Link
                      className="app-button secondary"
                      href={`/app/connect/${item.setup.id}`}
                    >
                      Continue setup
                    </Link>
                  ) : (
                    <button
                      className="app-button secondary"
                      onClick={() => {
                        setNotice("");
                        setSelected(item);
                      }}
                    >
                      {item.capabilities.length ? "Edit scope" : "Approve"}
                    </button>
                  )}
                  {!item.revokedAt && (
                    <button
                      className="app-button danger"
                      onClick={() => revoke(item.id)}
                      disabled={revoking !== null}
                    >
                      {revoking === item.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-4 text-xs leading-6 text-muted">
                {item.capabilities
                  .map((capability) => capabilityLabels[capability])
                  .join(" · ") || "No note access until approved"}
                <br />
                {item.personal
                  ? "Personal memories"
                  : "No personal access"} ·{" "}
                {item.allProjects
                  ? "All notebooks"
                  : `${item.projectIds.length} selected notebooks`}
              </p>
              {item.clientId && (
                <p className="mt-2 break-all font-mono text-[10px] text-muted">
                  Client: {item.clientId}
                </p>
              )}
              <p className="mt-2 text-[10px] text-muted">
                Created: {new Date(item.createdAt).toLocaleString()}
                <br />
                Last contact:{" "}
                {item.lastUsedAt
                  ? new Date(item.lastUsedAt).toLocaleString()
                  : "Not yet"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <Dialog
          title={
            selected === "new" ? "Create a scoped API key" : "Connection access"
          }
          close={() => setSelected(null)}
        >
          <GrantForm
            connection={selected === "new" ? undefined : selected}
            projects={projects}
            done={(value) => {
              setNotice(
                selected !== "new" && selected.clientId
                  ? "Access approved. Return to your chat, refresh or retry Grove, then ask it to save and recall a note to verify the connection."
                  : selected === "new"
                    ? ""
                    : "Access updated.",
              );
              setSelected(null);
              setSecret(value ?? "");
              setError("");
            }}
          />
        </Dialog>
      )}
      {secret && (
        <Dialog title="Your API key" close={() => setSecret("")}>
          <p className="text-sm leading-7 text-muted">
            Copy this key to your credential manager now. It will not be shown
            again.
          </p>
          <textarea
            className="mt-5 w-full rounded-lg border border-line bg-white p-4 font-mono text-xs"
            readOnly
            rows={4}
            aria-label="New API key"
            value={secret}
          />
          <button className="app-button mt-5" onClick={() => setSecret("")}>
            I have saved the key
          </button>
        </Dialog>
      )}
    </>
  );
}

function GrantForm({
  connection,
  projects,
  done,
}: {
  connection?: Connection;
  projects: Project[];
  done: (secret?: string) => void;
}) {
  const api = useWorkspaceApi();
  const [name, setName] = useState(
    connection?.name === "Awaiting approval" ? "" : (connection?.name ?? ""),
  );
  const [selected, setSelected] = useState<string[]>(
    connection?.capabilities.length
      ? connection.capabilities
      : ["memory:read", "memory:write"],
  );
  const [personal, setPersonal] = useState(connection?.personal ?? true);
  const [allProjects, setAllProjects] = useState(
    connection?.allProjects ?? false,
  );
  const [projectIds, setProjectIds] = useState(connection?.projectIds ?? []);
  const [expiry, setExpiry] = useState(
    connection?.expiresAt?.slice(0, 10) ?? "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  return (
    <form
      className="app-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
          const data = await api<{ secret?: string }>(
            connection ? `/connections/${connection.id}` : "/keys",
            {
              name,
              capabilities: selected,
              personal,
              allProjects,
              projectIds,
              ...(connection?.state ? { expectedState: connection.state } : {}),
              ...(expiry
                ? { expiresAt: new Date(`${expiry}T23:59:59Z`).toISOString() }
                : {}),
            },
            connection ? "PATCH" : "POST",
          );
          done(data.secret);
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      {connection?.clientId && (
        <div className="text-sm leading-7 text-muted">
          <p>
            Approve only the client you just signed in with, using the same
            Grove account. A name alone does not identify a chat provider.
          </p>
          <p className="mt-2 break-all text-xs">
            OAuth client: <code>{connection.clientId}</code>
          </p>
          <p className="text-xs">
            Created: {new Date(connection.createdAt).toLocaleString()}
          </p>
        </div>
      )}
      <label>
        Name
        <input
          required
          maxLength={100}
          placeholder="ChatGPT, Claude web, or my laptop"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <fieldset>
        <legend className="mb-3 text-xs font-medium">Capabilities</legend>
        <div className="grid gap-3">
          {capabilities.map((capability) => (
            <label key={capability} className="check">
              <input
                type="checkbox"
                checked={selected.includes(capability)}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked
                      ? [...current, capability]
                      : current.filter((c) => c !== capability),
                  )
                }
              />
              {capabilityLabels[capability]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-3 text-xs font-medium">Memory scope</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
          />
          Personal memories
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={allProjects}
            onChange={(e) => setAllProjects(e.target.checked)}
          />
          All current and future notebooks
        </label>
        {!allProjects &&
          notebookOptions(projects).map((project) => (
            <label key={project.value} className="check">
              <input
                type="checkbox"
                checked={projectIds.includes(project.value)}
                onChange={(e) =>
                  setProjectIds((current) =>
                    e.target.checked
                      ? [...current, project.value]
                      : current.filter((id) => id !== project.value),
                  )
                }
              />
              {project.label}
            </label>
          ))}
      </fieldset>
      <label>
        Expiry (optional)
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="app-error">
          {error}
        </p>
      )}
      <button className="app-button" disabled={busy || !selected.length}>
        {busy ? "Saving…" : connection ? "Approve access" : "Create key"}
      </button>
    </form>
  );
}
