import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDatabase } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { readServerEnvironment } from "@lib/environment";
import { GroveError } from "@lib/shared/contracts";
import { memoryTools } from "@lib/shared/memory-tools";
import { createMemoryMcp } from "@lib/integration-core/mcp";
import { createApp } from "../../packages/api/src/app.ts";

// Lazy pool with no listener: public proof/discovery must not query the database.
const db = createDatabase(
  "postgresql://unused:unused@127.0.0.1:1/directory_unit_test",
);
let queries = 0;
db.on("query", () => {
  queries++;
});
after(() => db.destroy());
const proof = "synthetic_openai_domain_proof_1234567890";
function app(token?: string) {
  let authentication = 0;
  const target = createApp({
    memories: new MemoryService(db, "directory-test-cursor-secret-at-least-32"),
    origin: "https://api.grove.example",
    siteUrl: "https://grove.example",
    issuer: "https://issuer.example",
    webhookSecret: "whsec_dGVzdA==",
    openaiAppsChallenge: token,
    auth: {
      principal: async () => {
        authentication++;
        throw new GroveError("unauthorized", "Sign in", 401);
      },
    },
    ready: async () => {
      throw new Error("Proof does not depend on readiness");
    },
  });
  return { target, authenticated: () => authentication };
}

test("directory verification serves exact plain text without opening private access", async () => {
  const { target, authenticated } = app(proof);
  const response = await target.request("/.well-known/openai-apps-challenge");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), proof);
  assert.match(response.headers.get("content-type")!, /^text\/plain/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const head = await target.request("/.well-known/openai-apps-challenge", {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(authenticated(), 0);
  assert.equal(queries, 0);
  const privateResponse = await target.request("/mcp", { method: "POST" });
  assert.equal(privateResponse.status, 401);
  assert.match(
    privateResponse.headers.get("www-authenticate")!,
    /oauth-protected-resource\/mcp/,
  );
  assert.equal(authenticated(), 1);
  assert.equal(queries, 0);
});

test("unconfigured proof and alternate paths or writes do not expose a token", async () => {
  assert.equal(
    (await app().target.request("/.well-known/openai-apps-challenge")).status,
    404,
  );
  const { target, authenticated } = app(proof);
  for (const [path, method] of [
    ["/.well-known/openai-apps-challenge/other", "GET"],
    ["/.well-known/openai-apps-challenge", "POST"],
    ["/.well-known/openai-apps-challenge", "PUT"],
  ]) {
    const result = await target.request(path, { method });
    assert.equal(result.status, 404);
    assert(!(await result.text()).includes(proof));
  }
  assert.equal(authenticated(), 0);
  assert.equal(queries, 0);
});

test("verification configuration preserves the exact bounded token and rejects whitespace", () => {
  const env = {
    DATABASE_URL: "unused",
    API_ORIGIN: "https://api.grove.example",
    SITE_URL: "https://grove.example",
    CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
    CLERK_SECRET_KEY: "sk_test_fixture",
    CLERK_ISSUER: "https://issuer.example",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_fixture",
    CURSOR_SECRET: "a".repeat(32),
  };
  assert.equal(
    readServerEnvironment({ ...env, OPENAI_APPS_CHALLENGE: proof })
      .OPENAI_APPS_CHALLENGE,
    proof,
  );
  assert.equal(
    readServerEnvironment({ ...env, OPENAI_APPS_CHALLENGE: "" })
      .OPENAI_APPS_CHALLENGE,
    undefined,
  );
  for (const value of [
    " leading",
    "trailing ",
    "line\nbreak",
    "line\rbreak",
    "a".repeat(513),
  ])
    assert.throws(() =>
      readServerEnvironment({ ...env, OPENAI_APPS_CHALLENGE: value }),
    );
});

test("every MCP tool publishes a human-readable title and explicit safety annotations", async () => {
  let calls = 0;
  const server = createMemoryMcp(async () => {
    calls++;
    throw new Error("Discovery cannot execute a tool");
  });
  const client = new Client({
    name: "directory-metadata-test",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, Object.keys(memoryTools).length);
    for (const tool of tools) {
      assert.equal(typeof tool.title, "string", `${tool.name} needs a title`);
      assert(tool.title!.trim().length > 0 && tool.title!.length <= 80);
      assert.equal(
        tool.annotations?.title,
        tool.title,
        `${tool.name} needs the same human-readable annotation title`,
      );
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean");
      assert.equal(typeof tool.annotations?.destructiveHint, "boolean");
    }
    assert.equal(calls, 0);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test("tool descriptions describe their own operation without cross-tool instructions", () => {
  const names = Object.keys(memoryTools);
  for (const [name, tool] of Object.entries(memoryTools)) {
    for (const other of names.filter(
      (candidate) => candidate !== name && candidate.includes("_"),
    )) {
      assert(
        !tool.description.includes(other),
        `${name} must describe its own behavior rather than referring to ${other}`,
      );
    }
  }
  assert.match(memoryTools.remember.description, /replace metadata/i);
  assert.match(memoryTools.memory_history.description, /100.*revisions/i);
  assert.match(memoryTools.archive_memory.description, /revers/i);
});
