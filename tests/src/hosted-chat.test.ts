import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDatabase } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { memoryTools } from "@lib/shared/memory-tools";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const db = createDatabase(url);
const service = new MemoryService(db, "hosted-chat-cursor-secret-at-least-32");
const subjects = {
  owner: `hosted_${randomUUID()}`,
  other: `hosted_${randomUUID()}`,
};
const identities = new Map<
  string,
  { account: keyof typeof subjects; clientId?: string }
>();
const auth = new Authentication(db, {
  async verify(token) {
    const identity = identities.get(token);
    if (!identity) throw new Error("Unknown test identity");
    return identity.clientId
      ? {
          type: "oauth",
          subject: subjects[identity.account],
          clientId: identity.clientId,
          issuedAt: Date.now(),
          scopes: ["openid"],
        }
      : {
          type: "session",
          subject: subjects[identity.account],
          sessionId: `session_${identity.account}`,
        };
  },
});
const app = createApp({
  memories: service,
  auth,
  origin: "https://mcp.example.test",
  siteUrl: "https://grove.example.test",
  issuer: "https://issuer.example.test",
  webhookSecret: "whsec_dGVzdA==",
  ready: async () => {},
});
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.destroy();
});
function token(account: keyof typeof subjects, clientId?: string) {
  const value = randomUUID();
  identities.set(value, { account, clientId });
  return value;
}
const owner = token("owner"),
  other = token("other");
async function request(
  bearer: string,
  path: string,
  body?: unknown,
  method?: string,
) {
  const response = await app.request(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function client(bearer: string) {
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const result = new Client({ name: "hosted-chat-test", version: "1.0.0" });
  await result.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      {
        requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      },
    ),
  );
  return result;
}
function data(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse(
    (result.content as { type: string; text: string }[])[0].text,
  );
}

test("hosted OAuth can scan before approval, with exact-client guidance instead of a login loop", async () => {
  const clientId = `chatgpt_${randomUUID()}`;
  const bearer = token("owner", clientId);
  const host = await client(bearer);
  try {
    const tools = await host.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      Object.keys(memoryTools).sort(),
    );
    const me = await request(bearer, "/v1/me");
    assert.deepEqual(me.body.data.capabilities, []);
    const result = await host.callTool({ name: "recall", arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(data(result).error.code, "connection_required");
    assert.match(data(result).error.message, /Sign-in is complete/);
    assert(
      data(result).error.message.includes(
        `https://grove.example.test/app/settings/connections#connection-${me.body.data.connectionId}`,
      ),
    );
    assert(data(result).error.message.includes(clientId));
    assert(!JSON.stringify(result).includes(bearer));
    assert.equal(
      result._meta?.["mcp/www_authenticate"],
      undefined,
      "A missing Grove grant must not restart OAuth",
    );
    assert.equal((await request(bearer, "/v1/recall", {})).status, 403);
  } finally {
    await host.close();
  }
});

test("two hosted clients share only owner-granted notes and keep mutation and revocation fences", async () => {
  const a = token("owner", `chatgpt_${randomUUID()}`),
    b = token("owner", `claude_web_${randomUUID()}`);
  const first = await client(a),
    second = await client(b);
  try {
    const ids = await Promise.all(
      [a, b].map(
        async (bearer) =>
          (await request(bearer, "/v1/me")).body.data.connectionId,
      ),
    );
    const grant = {
      name: "Synthetic hosted test",
      capabilities: ["memory:read", "memory:write"],
      personal: true,
      allProjects: false,
      projectIds: [],
    };
    assert.equal(
      (await request(other, `/v1/connections/${ids[0]}`, grant, "PATCH"))
        .status,
      404,
    );
    assert.equal(
      (await request(a, `/v1/connections/${ids[0]}`, grant, "PATCH")).status,
      403,
    );
    for (const id of ids)
      assert.equal(
        (await request(owner, `/v1/connections/${id}`, grant, "PATCH")).status,
        200,
      );
    const input = {
      operationId: randomUUID(),
      content: "Synthetic hosted-chat preference: concise examples",
      capture: "explicit",
      kind: "preference",
      retentionDays: 7,
    };
    const saved = data(
      await first.callTool({ name: "remember", arguments: input }),
    );
    assert(saved.id);
    assert.equal(
      data(await first.callTool({ name: "remember", arguments: input })).id,
      saved.id,
    );
    assert.equal(
      (
        await first.callTool({
          name: "remember",
          arguments: { ...input, content: "different" },
        })
      ).isError,
      true,
    );
    assert(
      data(await second.callTool({ name: "recall", arguments: {} })).items.some(
        (note: { id: string }) => note.id === saved.id,
      ),
    );
    const corrected = data(
      await second.callTool({
        name: "update_memory",
        arguments: {
          operationId: randomUUID(),
          id: saved.id,
          expectedVersion: saved.version,
          content: "Synthetic hosted-chat preference: short examples",
        },
      }),
    );
    assert.equal(corrected.kind, "preference");
    assert.equal(corrected.retentionDays, 7);
    assert.deepEqual(corrected.source, saved.source);
    assert.equal(
      (
        await first.callTool({
          name: "forget",
          arguments: {
            operationId: randomUUID(),
            items: [{ id: saved.id, expectedVersion: corrected.version }],
          },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await second.callTool({
          name: "notebook_lifecycle",
          arguments: { id: randomUUID(), action: "preview" },
        })
      ).isError,
      true,
    );
    await request(
      owner,
      `/v1/connections/${ids[1]}`,
      { ...grant, capabilities: ["memory:read"] },
      "PATCH",
    );
    assert.equal(
      (
        await second.callTool({
          name: "remember",
          arguments: { ...input, operationId: randomUUID() },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await second.callTool({
          name: "get_memory",
          arguments: { id: saved.id },
        })
      ).isError,
      undefined,
    );
    assert.equal(
      (await request(owner, `/v1/connections/${ids[0]}`, undefined, "DELETE"))
        .status,
      200,
    );
    await assert.rejects(first.callTool({ name: "recall", arguments: {} }));
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
