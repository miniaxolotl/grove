"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Plug, Plus } from "lucide-react";
import {
  capabilities,
  type Grant,
  type ConnectAttempt,
} from "@lib/shared/contracts";
import { api, errorMessage, type Project } from "@/lib/dashboard-api";
import { Dialog } from "./dialog";
import { LoadError } from "./load-error";
import { AgentSetup } from "@/components/installation";

type Connection = Grant & {
  id: string;
  clientId: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  setup?: ConnectAttempt | null;
};
export function Connections({ origin }: { origin: string }) {
  const [items, setItems] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Connection | "new" | null>(null);
  const [secret, setSecret] = useState("");
  const reload = () => {
    setError("");
    setLoading(true);
    setRefresh((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<Connection[]>(
        "/connections",
        undefined,
        undefined,
        controller.signal,
      ),
      api<Project[]>("/projects", undefined, undefined, controller.signal),
    ])
      .then(([connections, list]) => {
        setItems(
          connections.map((item) =>
            item.setup?.status === "pending" &&
            Date.parse(item.setup.expiresAt) <= Date.now()
              ? { ...item, setup: { ...item.setup, status: "expired" } }
              : item,
          ),
        );
        setProjects(list);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  async function revoke(id: string) {
    try {
      await api(`/connections/${id}`, undefined, "DELETE");
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <>
      <div className="app-page-heading">
        <div>
          <p className="eyebrow">SAME CONTEXT, ANY AGENT</p>
          <h1>
            Your connections<span className="text-leaf">.</span>
          </h1>
          <p>Choose what each agent can read, remember, and forget.</p>
        </div>
        <button className="app-button" onClick={() => setSelected("new")}>
          <Plus size={16} />
          Create API key
        </button>
      </div>
      <section className="app-panel mb-8">
        <div className="flex items-center gap-3">
          <Plug size={20} />
          <h2 className="font-editorial text-2xl">
            Bring an agent into your Grove.
          </h2>
        </div>
        <p className="mt-3 text-sm leading-7 text-muted">
          Choose OpenCode, Claude Code, or Codex and run its connection command.
          Sign in and choose its access in the browser. Setup finishes in your
          terminal.
        </p>
        <div className="mt-4">
          <AgentSetup origin={origin || undefined} headless />
        </div>
      </section>
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
            <li key={item.id} className="app-panel">
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
                      onClick={() => setSelected(item)}
                    >
                      {item.capabilities.length ? "Edit scope" : "Approve"}
                    </button>
                  )}
                  {!item.revokedAt && (
                    <button
                      className="app-button danger"
                      onClick={() => revoke(item.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-4 text-xs leading-6 text-muted">
                {item.capabilities.join(" · ") || "No capabilities"}
                <br />
                {item.personal
                  ? "Personal memories"
                  : "No personal access"} ·{" "}
                {item.allProjects
                  ? "All projects"
                  : `${item.projectIds.length} selected projects`}
              </p>
              {item.clientId && (
                <p className="mt-2 break-all font-mono text-[10px] text-muted">
                  Client: {item.clientId}
                </p>
              )}
              <p className="mt-2 text-[10px] text-muted">
                Last used:{" "}
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
              setSelected(null);
              setSecret(value ?? "");
              reload();
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
  return (
    <form
      className="app-form"
      onSubmit={async (event) => {
        event.preventDefault();
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
          setBusy(false);
        }
      }}
    >
      <label>
        Name
        <input
          required
          maxLength={100}
          placeholder="My laptop · Claude"
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
              {capability}
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
          All current and future projects
        </label>
        {!allProjects &&
          projects.map((project) => (
            <label key={project.id} className="check">
              <input
                type="checkbox"
                checked={projectIds.includes(project.id)}
                onChange={(e) =>
                  setProjectIds((current) =>
                    e.target.checked
                      ? [...current, project.id]
                      : current.filter((id) => id !== project.id),
                  )
                }
              />
              {project.name}
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
