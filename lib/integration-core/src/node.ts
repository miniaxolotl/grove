import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  chmod,
  rm,
  stat,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { basename, join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  GroveError,
  oauthScopes,
  type RecallResult,
} from "@lib/shared/contracts";
import {
  ApiClient,
  apiOrigin,
  formatContext,
  type ConnectionInfo,
} from "./index.ts";

export type AgentName = "cli" | "opencode" | "claude" | "codex";
export type Credentials = {
  origin: string;
  agent: AgentName;
  accountId: string;
  key?: string;
  tokens?: OAuthTokens;
  expiresAt?: number;
  client?: OAuthClientInformationMixed;
  redirectUrl?: string;
};
type Config = {
  origin?: string;
  accounts?: Record<string, Partial<Record<AgentName, string>>>;
  paused?: boolean;
  generation?: number;
};
const execute = promisify(execFile);
export const configDirectory = () =>
  process.env.GROVE_CONFIG_HOME ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "grove");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(
      await readFile(join(configDirectory(), "config.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new GroveError(
      "invalid_config",
      "Grove user configuration could not be read",
    );
  }
}
const writeConfig = (config: Config) =>
  atomicJson(join(configDirectory(), "config.json"), config);

/** One process-aware lock serializes refresh, login, account switching, pause and logout. */
async function withStoreLock<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const directory = configDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, ".store-lock");
  const deadline = AbortSignal.any([
    AbortSignal.timeout(10000),
    ...(signal ? [signal] : []),
  ]);
  for (;;) {
    deadline.throwIfAborted();
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let abandoned = false;
      try {
        const owner = JSON.parse(
          await readFile(join(lock, "owner.json"), "utf8"),
        );
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
          } catch (e) {
            abandoned = (e as NodeJS.ErrnoException).code === "ESRCH";
          }
        }
      } catch {
        // Recover a process that died between creating the directory and writing its PID.
        try {
          abandoned = Date.now() - (await stat(lock)).mtimeMs > 60000;
        } catch {
          /* Another process released it. */
        }
      }
      if (abandoned) {
        // Only one recoverer may move a dead lock. Recheck inside that recovery guard.
        const recovery = join(directory, ".store-recovery");
        try {
          await mkdir(recovery, { mode: 0o700 });
          try {
            let stillAbandoned = false;
            try {
              const owner = JSON.parse(
                await readFile(join(lock, "owner.json"), "utf8"),
              );
              if (Number.isInteger(owner.pid) && owner.pid > 0) {
                try {
                  process.kill(owner.pid, 0);
                } catch (e) {
                  stillAbandoned =
                    (e as NodeJS.ErrnoException).code === "ESRCH";
                }
              }
            } catch {
              try {
                stillAbandoned =
                  Date.now() - (await stat(lock)).mtimeMs > 60000;
              } catch {
                /* Released. */
              }
            }
            if (stillAbandoned) {
              const stale = `${lock}.${randomUUID()}.stale`;
              await rename(lock, stale);
              await rm(stale, { recursive: true, force: true });
            }
          } finally {
            await rm(recovery, { recursive: true, force: true });
          }
        } catch {
          /* Another process is recovering it. */
        }
      }
      await delay(25, undefined, { signal: deadline });
    }
  }
  try {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      { mode: 0o600, flag: "wx" },
    );
    return await run();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export const updateConfig = (change: Partial<Pick<Config, "paused">>) =>
  withStoreLock(async () => {
    const config = await readConfig();
    await writeConfig({
      ...config,
      ...change,
      generation: (config.generation ?? 0) + 1,
    });
  });
export async function configuredOrigin(override?: string) {
  const origin =
    override ?? process.env.GROVE_API_URL ?? (await readConfig()).origin;
  if (!origin)
    throw new GroveError(
      "not_configured",
      "Run grove init --url <your Grove API origin>",
    );
  return apiOrigin(origin);
}
function credentialPath(origin: string, agent: AgentName, accountId: string) {
  return join(
    configDirectory(),
    `credentials-${hash(`${origin}|${agent}|${accountId}`)}.json`,
  );
}
export async function loadCredentials(
  origin: string,
  agent: AgentName,
): Promise<Credentials> {
  const accountId = (await readConfig()).accounts?.[origin]?.[agent];
  if (!accountId)
    throw new GroveError(
      "sign_in_required",
      `Run grove login --client ${agent} --url ${origin}`,
      401,
    );
  try {
    const value = JSON.parse(
      await readFile(credentialPath(origin, agent, accountId), "utf8"),
    ) as Credentials;
    if (
      value.origin !== origin ||
      value.agent !== agent ||
      value.accountId !== accountId
    )
      throw new Error();
    return value;
  } catch {
    throw new GroveError(
      "sign_in_required",
      "Grove credentials are missing or invalid; sign in again",
      401,
    );
  }
}
export async function saveCredentials(value: Credentials) {
  await withStoreLock(async () => {
    await atomicJson(
      credentialPath(value.origin, value.agent, value.accountId),
      value,
    );
    const config = await readConfig();
    config.origin = value.origin;
    config.accounts ??= {};
    config.accounts[value.origin] = {
      ...config.accounts[value.origin],
      [value.agent]: value.accountId,
    };
    config.generation = (config.generation ?? 0) + 1;
    await writeConfig(config);
  });
}
/** Select an already authenticated origin without replacing possibly refreshed tokens. */
export async function activateCredentials(
  origin: string,
  agent: AgentName,
  accountId: string,
) {
  await withStoreLock(async () => {
    const credentials = await loadCredentials(origin, agent);
    if (credentials.accountId !== accountId)
      throw new GroveError(
        "account_changed",
        "Grove account changed; run connect again",
        409,
      );
    const config = await readConfig();
    if (config.origin !== origin)
      await writeConfig({
        ...config,
        origin,
        generation: (config.generation ?? 0) + 1,
      });
  });
}
export async function clearCredentials(origin: string, agent: AgentName) {
  await withStoreLock(async () => {
    const config = await readConfig();
    const account = config.accounts?.[origin]?.[agent];
    if (account)
      await rm(credentialPath(origin, agent, account), { force: true });
    if (config.accounts?.[origin]) delete config.accounts[origin][agent];
    config.generation = (config.generation ?? 0) + 1;
    await writeConfig(config);
  });
}

export class BrowserOAuthProvider implements OAuthClientProvider {
  private verifier = "";
  private csrf = randomUUID();
  constructor(
    public data: Partial<Credentials> & {
      origin: string;
      agent: AgentName;
      redirectUrl: string;
    },
    private redirect: (url: URL) => Promise<void>,
  ) {}
  get redirectUrl() {
    return this.data.redirectUrl;
  }
  get clientMetadata() {
    return {
      client_name: `Grove ${this.data.agent}`,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: oauthScopes.join(" "),
    };
  }
  state() {
    return this.csrf;
  }
  checkState(state: string | null) {
    return state === this.csrf;
  }
  clientInformation() {
    return this.data.client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.data.client = client;
  }
  tokens() {
    return this.data.tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    this.data.tokens = tokens;
    this.data.expiresAt = Date.now() + (tokens.expires_in ?? 300) * 1000;
  }
  async redirectToAuthorization(url: URL) {
    await this.redirect(url);
  }
  saveCodeVerifier(value: string) {
    this.verifier = value;
  }
  codeVerifier() {
    return this.verifier;
  }
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    if (scope === "all" || scope === "tokens") delete this.data.tokens;
    if (scope === "all" || scope === "client") delete this.data.client;
    if (scope === "all" || scope === "verifier") this.verifier = "";
  }
}

export async function bearer(
  origin: string,
  agent: AgentName,
  signal?: AbortSignal,
) {
  // Environment keys are explicitly paired with their target origin, never a project-supplied URL.
  if (
    process.env.GROVE_API_KEY &&
    process.env.GROVE_API_URL &&
    apiOrigin(process.env.GROVE_API_URL) === origin
  )
    return process.env.GROVE_API_KEY;
  const credentials = await loadCredentials(origin, agent);
  if (credentials.key) return credentials.key;
  if (
    credentials.tokens?.access_token &&
    (credentials.expiresAt ?? 0) > Date.now() + 30000
  )
    return credentials.tokens.access_token;
  if (!credentials.redirectUrl)
    throw new GroveError("sign_in_required", "Sign in to Grove again", 401);
  return withStoreLock(async () => {
    const current = await loadCredentials(origin, agent);
    if (current.accountId !== credentials.accountId)
      throw new GroveError(
        "account_changed",
        "Grove account changed; retry the operation",
        409,
      );
    if (current.key) return current.key;
    if (
      current.tokens?.access_token &&
      (current.expiresAt ?? 0) > Date.now() + 30000
    )
      return current.tokens.access_token;
    const provider = new BrowserOAuthProvider(
      { ...current, redirectUrl: current.redirectUrl! },
      async () => {
        throw new GroveError(
          "sign_in_required",
          "Grove sign-in expired; run grove login",
          401,
        );
      },
    );
    await auth(provider, {
      serverUrl: `${origin}/mcp`,
      fetchFn: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(10000),
            ...(signal ? [signal] : []),
          ]),
        }),
    });
    if (!provider.data.tokens?.access_token)
      throw new GroveError("sign_in_required", "Sign in to Grove again", 401);
    await atomicJson(
      credentialPath(origin, agent, current.accountId),
      provider.data,
    );
    return provider.data.tokens.access_token;
  }, signal);
}

export async function nodeClient(
  agent: AgentName = "cli",
  origin?: string,
  timeoutMs = 10000,
) {
  const endpoint = await configuredOrigin(origin);
  return new ApiClient(
    endpoint,
    (signal) => bearer(endpoint, agent, signal),
    timeoutMs,
  );
}

export function canonicalRepository(remote: string) {
  const normalized = remote.trim().replace(/^git@([^:]+):/, "ssh://git@$1/");
  const url = new URL(normalized);
  if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
    throw new Error("Unsupported Git remote");
  return `git:${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}/${url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "")}`;
}
export async function projectIdentity(
  directory: string,
): Promise<{ identity: string; name: string } | null> {
  if (process.env.GROVE_PROJECT_IDENTITY)
    return {
      identity: process.env.GROVE_PROJECT_IDENTITY,
      name: process.env.GROVE_PROJECT_NAME ?? "Project",
    };
  try {
    const { stdout } = await execute(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: directory, timeout: 1000, maxBuffer: 8192 },
    );
    const identity = canonicalRepository(stdout);
    return { identity, name: identity.split("/").at(-1)! };
  } catch {
    try {
      const { stdout } = await execute(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: directory, timeout: 1000, maxBuffer: 8192 },
      );
      return {
        identity: `local:${hash(stdout.trim())}`,
        name: basename(dirname(stdout.trim())),
      };
    } catch {
      return null;
    }
  }
}
export async function resolveProject(
  client: ApiClient,
  directory: string,
  create = false,
  signal?: AbortSignal,
) {
  const project = await projectIdentity(directory);
  if (!project) return null;
  const projects = await client.request<{ id: string; identity: string }[]>(
    "/v1/projects",
    { signal },
  );
  const found = projects.find((p) => p.identity === project.identity);
  if (found) return found.id;
  if (!create) return null;
  return (
    await client.request<{ id: string }>("/v1/projects", {
      body: project,
      signal,
    })
  ).id;
}
export async function automaticContext(
  agent: AgentName,
  directory: string,
  signal?: AbortSignal,
  budget = 6000,
) {
  const deadline = AbortSignal.any([
    AbortSignal.timeout(1500),
    ...(signal ? [signal] : []),
  ]);
  const work = async () => {
    const before = await readConfig();
    if (process.env.GROVE_PRIVATE === "1" || before.paused) return "";
    const client = await nodeClient(agent, undefined, 1500);
    const me = await client.request<ConnectionInfo>("/v1/me", {
      signal: deadline,
    });
    if (!me.recallEnabled) return "";
    const projectId = await resolveProject(client, directory, false, deadline);
    const result = await client.request<RecallResult>("/v1/recall", {
      body: { projectId },
      signal: deadline,
    });
    const after = await readConfig();
    if (
      after.generation !== before.generation ||
      after.paused ||
      process.env.GROVE_PRIVATE === "1" ||
      deadline.aborted
    )
      return "";
    const context = formatContext(result, Math.max(0, budget - 350));
    return `Grove current project: ${projectId ?? "unconfigured; personal scope only"}. Automatic capture: ${me.captureEnabled ? "permitted for confirmed context; set capture=automatic on these saves" : "paused; explicit user-requested saves only"}.\n${context}`;
  };
  return Promise.race([
    work().catch(() => ""),
    new Promise<string>((resolve) => {
      if (deadline.aborted) resolve("");
      else
        deadline.addEventListener("abort", () => resolve(""), { once: true });
    }),
  ]);
}
