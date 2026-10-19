/** Opt-in: run against a disposable Clerk account after browser login and grant approval. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import {
  bearer,
  loadCredentials,
  saveCredentials,
  configuredOrigin,
  automaticContext,
  nodeClient,
  clearCredentials,
} from "../../lib/integration-core/src/node.ts";
import { clerkVerifier } from "../../packages/api/src/auth.ts";
import { readServerEnvironment } from "../../lib/environment/src/index.ts";

if (process.env.GROVE_LIVE_TEST !== "1")
  throw new Error(
    "Set GROVE_LIVE_TEST=1 with a disposable test account and isolated GROVE_CONFIG_HOME",
  );
const origin = await configuredOrigin();
const credentials = await loadCredentials(origin, "cli");
assert(
  credentials.tokens?.refresh_token,
  "Browser OAuth credentials with refresh are required",
);
const api = await nodeClient();
const before = await api.request<{ accountId: string; capabilities: string[] }>(
  "/v1/me",
);
assert(before.capabilities.includes("memory:read"));
await assert.rejects(
  api.request("/v1/keys", {
    body: { name: "must be denied", capabilities: ["memory:read"] },
  }),
  { code: "forbidden" },
);
await saveCredentials({ ...credentials, expiresAt: 0 });
const token = await bearer(origin, "cli");
assert(
  token !== credentials.tokens.access_token,
  "Access token should rotate after refresh",
);
assert.equal(
  (await api.request<{ accountId: string }>("/v1/me")).accountId,
  before.accountId,
);
const env = readServerEnvironment();
await assert.rejects(
  clerkVerifier({
    ...env,
    API_ORIGIN: "https://wrong-audience.example",
  }).verify(token),
  { code: "unauthorized" },
);
const results = [];
for (const transport of [
  new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
  new StdioClientTransport({
    command: process.execPath,
    args: [resolve("packages/mcp/dist/cli.js"), "mcp", "--stdio"],
    env: {
      PATH: process.env.PATH!,
      GROVE_CONFIG_HOME: process.env.GROVE_CONFIG_HOME!,
    },
    stderr: "pipe",
  }),
]) {
  const client = new Client({ name: "grove-live-verification", version: "1" });
  try {
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ["remember", "recall", "memories", "forget"],
    );
    const result = await client.callTool({
      name: "recall",
      arguments: { query: "concise", projectId: null },
    });
    assert.notEqual(result.isError, true);
    const data = (
      result.structuredContent as { data: { items: { id: string }[] } }
    ).data;
    assert(
      data.items.length > 0,
      "Create a personal memory containing 'concise' in this account first",
    );
    results.push(data.items.map((item) => item.id));
  } finally {
    await client.close();
  }
}
assert.deepEqual(results[0], results[1]);
const context = await automaticContext("cli", process.cwd());
assert(context.length <= 6000);
process.env.GROVE_PRIVATE = "1";
assert.equal(await automaticContext("cli", process.cwd()), "");
delete process.env.GROVE_PRIVATE;
if (process.env.GROVE_LIVE_REVOKE === "1") {
  const current = await loadCredentials(origin, "cli");
  await api.request("/v1/logout", { body: {} });
  await assert.rejects(api.request("/v1/me"), { code: "connection_revoked" });
  const discovery = await fetch(
    new URL("/.well-known/openid-configuration", env.CLERK_ISSUER),
  );
  const metadata = (await discovery.json()) as { revocation_endpoint: string };
  assert.equal(new URL(metadata.revocation_endpoint).origin, env.CLERK_ISSUER);
  for (const value of [
    current.tokens!.access_token,
    current.tokens!.refresh_token!,
  ]) {
    const response = await fetch(metadata.revocation_endpoint, {
      method: "POST",
      body: new URLSearchParams({
        token: value,
        client_id: current.client!.client_id,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert(response.ok, "Provider token revocation should succeed");
  }
  await assert.rejects(
    clerkVerifier(env).verify(current.tokens!.access_token),
    { code: "unauthorized" },
  );
  await clearCredentials(origin, "cli");
  await assert.rejects(loadCredentials(origin, "cli"), {
    code: "sign_in_required",
  });
}
console.log(
  JSON.stringify({
    status: "passed",
    accountId: before.accountId,
    checks: [
      "live refresh rotation",
      "exact resource audience",
      "agent cannot issue keys",
      "HTTP MCP recall",
      "stdio MCP shared credentials",
      "private context suppression",
      ...(process.env.GROVE_LIVE_REVOKE === "1"
        ? ["Grove logout", "live provider revocation", "credential removal"]
        : []),
    ],
    recalledIds: results[0],
    contextCharacters: context.length,
  }),
);
