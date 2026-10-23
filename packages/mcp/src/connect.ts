import { setTimeout as delay } from "node:timers/promises";
import {
  ApiClient,
  apiOrigin,
  type ConnectionInfo,
} from "@lib/integration-core";
import {
  nodeClient,
  projectIdentity,
  loadCredentials,
  activateCredentials,
  type AgentName,
} from "@lib/integration-core/node";
import {
  GroveError,
  agentNames,
  type ConnectAttempt,
  type ConnectResponse,
  type ConnectInput,
} from "@lib/shared/contracts";
import {
  installIntegration,
  requireClient,
  activationInstructions,
} from "./install.ts";
import { openBrowser } from "./browser.ts";
import { telemetry } from "@lib/telemetry";

export const cloudOrigin = "https://api.usegrove.cloud";
export type LoginOptions = {
  freshClient?: boolean;
  afterLogin?: (me: ConnectionInfo) => Promise<string | undefined>;
};
type Login = (
  origin: string,
  agent: AgentName,
  keyStdin: boolean,
  noBrowser: boolean,
  options?: LoginOptions,
) => Promise<ConnectionInfo>;

export async function waitForApproval(
  client: ApiClient,
  attempt: ConnectAttempt,
  signal: AbortSignal,
  interval = 2000,
) {
  let retryInterval = interval;
  let recovering = false;
  while (attempt.status === "pending") {
    try {
      await delay(retryInterval, undefined, { signal });
      attempt = await client.request<ConnectAttempt>(
        `/v1/connect/${attempt.id}`,
        { signal },
      );
      retryInterval = interval;
      if (recovering) console.error("✓ Connection restored; continuing setup");
      recovering = false;
    } catch (error) {
      if (signal.aborted)
        throw new GroveError(
          "approval_timeout",
          "Approval timed out. Run the same grove connect command to resume.",
          408,
        );
      if (
        error instanceof GroveError &&
        (error.status >= 500 || ["timeout", "unreachable"].includes(error.code))
      ) {
        if (!recovering)
          console.error(
            "Grove is temporarily unavailable. Reconnecting automatically…",
          );
        recovering = true;
        retryInterval = Math.min(retryInterval * 2, 8000);
        continue;
      }
      if (
        error instanceof GroveError &&
        error.code === "connection_unavailable"
      )
        throw new GroveError(
          error.code,
          "Connection access changed or this setup was replaced. Run the same grove connect command to resume with your current access.",
          error.status,
        );
      throw error;
    }
  }
  if (attempt.status !== "approved")
    throw new GroveError(
      attempt.status === "cancelled"
        ? "connection_cancelled"
        : "connection_expired",
      `Connection ${attempt.status}. Run grove connect when you are ready.`,
      409,
    );
  return attempt;
}

export async function connectAgent(
  options: {
    agent: ConnectInput["agent"];
    origin: string;
    noBrowser: boolean;
    json: boolean;
  },
  login: Login,
) {
  const { agent, noBrowser } = options;
  const origin = apiOrigin(options.origin);
  const environmentKey = !!(
    process.env.GROVE_API_KEY &&
    process.env.GROVE_API_URL &&
    apiOrigin(process.env.GROVE_API_URL) === origin
  );
  await requireClient(agent);
  console.error(`✓ ${agentNames[agent]} found`);
  const project = await projectIdentity(process.cwd());
  const client = await nodeClient(agent, origin);
  let attempt: ConnectResponse | undefined;
  const start = async () => {
    attempt = await client.request<ConnectResponse>("/v1/connect", {
      body: { agent, project },
    });
    const url = new URL(attempt.approvalUrl);
    apiOrigin(url.origin);
    if (
      url.username ||
      url.password ||
      url.pathname !== `/app/connect/${attempt.id}` ||
      url.search ||
      url.hash
    )
      throw new GroveError(
        "invalid_response",
        "Grove returned an invalid connection link",
        502,
      );
    return attempt.status === "pending" ? url.href : undefined;
  };
  let me: ConnectionInfo;
  try {
    me = await client.request<ConnectionInfo>("/v1/me");
  } catch (error) {
    if (
      !(error instanceof GroveError) ||
      !["sign_in_required", "unauthorized", "connection_revoked"].includes(
        error.code,
      ) ||
      environmentKey
    )
      throw error;
    if ((await loadCredentials(origin, agent).catch(() => undefined))?.key)
      throw new GroveError(
        "sign_in_required",
        "This API key is unavailable. Run grove login --key-stdin with a new key, then retry connect.",
        401,
      );
    me = await login(origin, agent, false, noBrowser, {
      freshClient:
        error.code === "connection_revoked" || error.code === "unauthorized",
      afterLogin: start,
    });
  }
  console.error("✓ Signed in");
  if (!attempt) {
    const approvalUrl = await start();
    if (approvalUrl) openBrowser(new URL(approvalUrl), noBrowser);
  }
  if (attempt!.status === "pending") {
    console.error(
      `Approve ${agentNames[agent]} in your browser. Waiting for access…`,
    );
    console.error(attempt!.approvalUrl);
  }
  const approved = await waitForApproval(
    client,
    attempt!,
    AbortSignal.timeout(10 * 60_000),
  );
  const verified = await client.request<ConnectionInfo>("/v1/me");
  if (
    verified.accountId !== me.accountId ||
    approved.connectionId !== me.connectionId ||
    verified.connectionId !== approved.connectionId
  )
    throw new GroveError(
      "account_changed",
      "The Grove account changed. Run grove connect again.",
      409,
    );
  if (
    !verified.capabilities.length ||
    (approved.projectId &&
      !verified.grant?.allProjects &&
      !verified.grant?.projectIds.includes(approved.projectId))
  )
    throw new GroveError(
      "connection_scope",
      "Connection access changed. Run grove connect again.",
      403,
    );
  const recallVerified = verified.capabilities.includes("memory:read");
  if (recallVerified) {
    await client.request("/v1/recall", {
      body: {
        projectId:
          approved.projectId ??
          (verified.grant?.personal
            ? null
            : (verified.grant?.projectIds[0] ?? null)),
        includePersonal: !!verified.grant?.personal,
        limit: 1,
        maxCharacters: 256,
      },
    });
  }
  if (!environmentKey) await activateCredentials(origin, agent, me.accountId);
  console.error(
    recallVerified
      ? "✓ Memory access verified"
      : "✓ Grant verified (read access not selected)",
  );
  console.error(
    approved.projectId
      ? `✓ Project linked: ${project?.name}`
      : verified.grant?.personal
        ? "✓ Personal memory access ready; no current project linked"
        : "✓ Selected scopes ready; current project access was not selected",
  );
  await installIntegration(agent);
  if (environmentKey)
    console.error(
      "Launch your agent with the same GROVE_API_URL and GROVE_API_KEY environment.",
    );
  const activation = activationInstructions(agent);
  telemetry(agent).capture("agent_connected", { agent });
  if (options.json)
    console.log(
      JSON.stringify({
        status: "connected",
        origin,
        agent,
        accountId: me.accountId,
        connectionId: approved.connectionId,
        projectId: approved.projectId,
        capabilities: verified.capabilities,
        recallVerified,
        restartRequired: activation.restartRequired,
        hostVerified: false,
        nextStep: activation.message,
      }),
    );
  else {
    const prompt = verified.capabilities.includes("memory:write")
      ? verified.grant?.personal
        ? "Use Grove to remember that I prefer concise answers in my personal memories."
        : "Use Grove to save a confirmed decision in an allowed project."
      : "Recall my available memories from Grove.";
    console.log(
      `Grove API access verified. Host activation is not yet verified.\n${activation.message}\nAsk your agent: "${prompt}"`,
    );
  }
}
