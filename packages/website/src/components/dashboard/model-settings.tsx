"use client";
import { Select } from "./ui/select";
import { useEffect, useState } from "react";
import type {
  ModelConfig,
  ModelRole,
  ModelSettings as Settings,
} from "@lib/shared/models";
import { api, errorMessage } from "@/lib/dashboard-api";
import { LoadError } from "./load-error";
import { ProviderOverview } from "./provider-overview";

type Usage = {
  dailyRequestLimit: number;
  failedJobs: number;
  today: {
    role: string;
    requests: number;
    inputTokens: string;
    outputTokens: string;
  }[];
};
const roles: ModelRole[] = ["embedding", "decision", "generation"];
export function ModelSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [clearKeys, setClearKeys] = useState<ModelRole[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<Settings>("/models", undefined, undefined, controller.signal),
      api<Usage>("/account/usage", undefined, undefined, controller.signal),
    ])
      .then(([value, counts]) => {
        setSettings(value);
        setConfig(value.config);
        setUsage(counts);
        setClearKeys([]);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [refresh]);
  function change<R extends ModelRole>(
    role: R,
    patch: Partial<ModelConfig[R]>,
  ) {
    setConfig(
      (current) =>
        current && { ...current, [role]: { ...current[role], ...patch } },
    );
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="app-page-heading">
        <div>
          <h1>
            {settings?.editable ? "Model settings" : "Search & organization"}
          </h1>
        </div>
      </div>
      {error && (
        <LoadError
          message={error}
          retry={() => {
            setError("");
            setRefresh((v) => v + 1);
          }}
        />
      )}
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      {!config || !settings ? (
        !error && <p role="status">Loading settings…</p>
      ) : !settings.editable ? (
        <ProviderOverview settings={settings} />
      ) : (
        <form
          className="app-form max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const saved = await api<Settings>(
                "/models",
                { expectedVersion: settings.version, config, clearKeys },
                "PATCH",
              );
              setSettings(saved);
              setConfig(saved.config);
              setClearKeys([]);
              setNotice(
                "Model settings saved. Changed profiles are queued for background processing.",
              );
            });
          }}
        >
          <p className="text-sm leading-7 text-muted">
            {settings.edition === "cloud"
              ? "Grove Cloud manages these providers for your account."
              : settings.editable
                ? "These settings apply to this installation. Keys are encrypted on the server; leave a key blank to keep it."
                : "Your installation administrator manages these providers."}
          </p>
          {roles.map((role) => (
            <section key={role} className="app-panel min-w-0">
              <h2 className="font-editorial text-2xl capitalize">{role}</h2>
              <p className="mt-2 text-sm text-muted">
                {role === "embedding"
                  ? "Find memories by meaning. A model or dimension change rebuilds the index."
                  : role === "decision"
                    ? "Classify memories and assess related, duplicate, or conflicting context."
                    : "Write titles, tags, project briefs, personal profiles, and task handoffs."}
              </p>
              <fieldset
                disabled={!settings.editable || busy}
                className="mt-5 space-y-4"
              >
                <legend className="sr-only">{role} provider settings</legend>
                <Select
                  label="Provider"
                  disabled={!settings.editable || busy}
                  value={config[role].provider}
                  onValueChange={(provider) => {
                    if (role === "embedding")
                      change(
                        role,
                        provider === "local"
                          ? {
                              provider,
                              model: "Xenova/all-MiniLM-L6-v2",
                              dimensions: 384,
                              queryPrefix: "",
                              documentPrefix: "",
                              distanceThreshold: 0.45,
                            }
                          : {
                              provider:
                                provider as ModelConfig["embedding"]["provider"],
                            },
                      );
                    else if (role === "decision")
                      change(role, {
                        provider:
                          provider as ModelConfig["decision"]["provider"],
                      });
                    else
                      change(role, {
                        provider:
                          provider as ModelConfig["generation"]["provider"],
                        reasoningEffort:
                          provider === "openai-compatible" ? "omit" : "low",
                      });
                  }}
                  options={[
                    { value: "disabled", label: "Disabled" },
                    ...(role === "decision"
                      ? [
                          {
                            value: "system-one",
                            label: "System One / DeepInfra",
                          },
                        ]
                      : [
                          {
                            value: role === "embedding" ? "local" : "minimax",
                            label:
                              role === "embedding" ? "Local MiniLM" : "MiniMax",
                          },
                          {
                            value: "openai-compatible",
                            label: "OpenAI-compatible API",
                          },
                        ]),
                  ]}
                />
                {config[role].provider !== "disabled" && (
                  <>
                    <label>
                      Model
                      <input
                        required
                        value={config[role].model}
                        maxLength={200}
                        disabled={config[role].provider === "local"}
                        onChange={(e) =>
                          change(role, { model: e.target.value })
                        }
                      />
                    </label>
                    {config[role].provider !== "local" && (
                      <>
                        <label>
                          API base URL
                          <input
                            required
                            type="url"
                            value={config[role].baseUrl}
                            onChange={(e) =>
                              change(role, { baseUrl: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          API key
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={config[role].apiKey}
                            placeholder={
                              settings.credentials[role]
                                ? "Key stored — leave blank to keep"
                                : "No key stored"
                            }
                            onChange={(e) =>
                              change(role, { apiKey: e.target.value })
                            }
                          />
                        </label>
                        {settings.editable && (
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={clearKeys.includes(role)}
                              onChange={(e) =>
                                setClearKeys(
                                  e.target.checked
                                    ? [...clearKeys, role]
                                    : clearKeys.filter((r) => r !== role),
                                )
                              }
                            />
                            Clear stored key
                          </label>
                        )}
                        <label>
                          Request timeout (milliseconds)
                          <input
                            type="number"
                            min={100}
                            max={90000}
                            value={config[role].timeoutMs}
                            onChange={(e) =>
                              change(role, {
                                timeoutMs: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                    {role === "embedding" && (
                      <>
                        <label>
                          Dimensions
                          <input
                            type="number"
                            min={32}
                            max={16000}
                            disabled={config.embedding.provider === "local"}
                            value={config.embedding.dimensions}
                            onChange={(e) =>
                              change(role, {
                                dimensions: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        {config.embedding.provider !== "local" && (
                          <>
                            <label>
                              Query prefix
                              <textarea
                                rows={2}
                                value={config.embedding.queryPrefix}
                                maxLength={1000}
                                onChange={(e) =>
                                  change(role, { queryPrefix: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Document prefix
                              <textarea
                                rows={2}
                                value={config.embedding.documentPrefix}
                                maxLength={1000}
                                onChange={(e) =>
                                  change(role, {
                                    documentPrefix: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Maximum cosine distance
                              <input
                                type="number"
                                min={0}
                                max={2}
                                step={0.01}
                                value={config.embedding.distanceThreshold}
                                onChange={(e) =>
                                  change(role, {
                                    distanceThreshold: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          </>
                        )}
                      </>
                    )}
                    {role === "decision" && (
                      <Select
                        label="Endpoint path"
                        disabled={!settings.editable || busy}
                        value={config.decision.path}
                        onValueChange={(value) =>
                          change(role, {
                            path: value as ModelConfig["decision"]["path"],
                          })
                        }
                        options={["/decisions", "/systemone"].map((value) => ({
                          value,
                          label: value,
                        }))}
                      />
                    )}
                    {role === "generation" && (
                      <>
                        <Select
                          label="Structured output"
                          disabled={!settings.editable || busy}
                          value={config.generation.outputFormat}
                          onValueChange={(value) =>
                            change(role, {
                              outputFormat:
                                value as ModelConfig["generation"]["outputFormat"],
                            })
                          }
                          options={[
                            { value: "tool", label: "Function call" },
                            { value: "json-schema", label: "JSON schema" },
                            { value: "json", label: "JSON object" },
                          ]}
                        />
                        <Select
                          label="Reasoning effort"
                          disabled={!settings.editable || busy}
                          value={config.generation.reasoningEffort}
                          onValueChange={(value) =>
                            change(role, {
                              reasoningEffort:
                                value as ModelConfig["generation"]["reasoningEffort"],
                            })
                          }
                          options={["low", "medium", "high", "omit"].map(
                            (value) => ({
                              value,
                              label: value[0].toUpperCase() + value.slice(1),
                            }),
                          )}
                        />
                        <label>
                          Maximum output tokens
                          <input
                            type="number"
                            min={256}
                            max={16384}
                            value={config.generation.maxOutputTokens}
                            onChange={(e) =>
                              change(role, {
                                maxOutputTokens: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
              </fieldset>
              <p className="mt-4 break-all font-mono text-[10px] text-muted">
                Active profile: {settings.profiles[role] ?? "disabled"}
              </p>
              {settings.editable && settings.profiles[role] && (
                <button
                  type="button"
                  disabled={busy}
                  className="app-button secondary mt-4"
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{
                        latencyMs: number;
                        dimensions?: number;
                      }>("/models/test", { role });
                      setNotice(
                        `${role} connection verified in ${result.latencyMs} ms${result.dimensions ? ` · ${result.dimensions} dimensions` : ""}.`,
                      );
                    })
                  }
                >
                  Test saved {role} configuration
                </button>
              )}
            </section>
          ))}
          {settings.editable && (
            <button className="app-button w-fit" disabled={busy}>
              {busy ? "Working…" : "Save model settings"}
            </button>
          )}
        </form>
      )}
      {settings?.editable && usage && (
        <section className="app-panel mt-6 max-w-3xl">
          <h2 className="font-editorial text-2xl">Usage today</h2>
          <p className="mt-3 text-sm text-muted">
            {usage.today.reduce((n, row) => n + row.requests, 0)} /{" "}
            {usage.dailyRequestLimit} requests ·{" "}
            {usage.failedJobs
              ? `${usage.failedJobs} items need attention`
              : "No processing issues"}
          </p>
          <details className="agent-details mt-4">
            <summary>Processing details</summary>
            <ul className="mt-4 space-y-2 text-sm">
              {usage.today.map((row) => (
                <li key={row.role} className="capitalize">
                  {row.role}: {row.requests} requests · {row.inputTokens} input
                  / {row.outputTokens} output tokens
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
