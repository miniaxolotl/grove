import { test } from "node:test";
import assert from "node:assert/strict";
import * as clientModule from "../../packages/browser-extension/src/client.ts";

test("extension controller preserves reviewed drafts, retries, grants and context versions", async () => {
  assert.equal(typeof clientModule.ExtensionClient, "function");
  const local = new Map<string, unknown>(),
    session = new Map<string, unknown>();
  const store = (map: Map<string, unknown>) => ({
    async get(k: string) {
      return map.get(k);
    },
    async set(k: string, v: unknown) {
      map.set(k, structuredClone(v));
    },
    async remove(k: string) {
      map.delete(k);
    },
  });
  const accountId = "00000000-0000-4000-a000-000000000001",
    connectionId = "00000000-0000-4000-a000-000000000002",
    id = "00000000-0000-4000-a000-000000000003";
  const note = {
    id,
    projectId: null,
    content: "Original note",
    kind: "fact",
    version: 1,
    status: "active",
    source: { agent: "api" },
    taskId: null,
    expiresAt: null,
    purgeAt: null,
    indexing: "disabled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let fail = true,
    write = true;
  const writes: unknown[] = [];
  const urls: string[] = [];
  const searches: unknown[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    urls.push(path);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fixture-token",
    );
    let data: unknown;
    if (path === "/v1/browser/connect")
      data = {
        accountId,
        connectionId,
        capabilities: write ? ["memory:read", "memory:write"] : ["memory:read"],
        grant: { personal: true, allProjects: false, projectIds: [] },
        siteUrl: "https://grove.example",
      };
    else if (path === "/v1/tools/notebooks")
      data = { items: [], nextCursor: null };
    else if (path === "/v1/browser/captures") {
      writes.push(JSON.parse(String(init?.body)));
      if (fail) {
        fail = false;
        throw new Error("connection lost after acceptance");
      }
      data = note;
    } else if (path === `/v1/memories/${id}`) data = note;
    else if (path === "/v1/memories/search") {
      searches.push(JSON.parse(String(init?.body)));
      data = { items: [], nextCursor: null };
    } else data = { items: [], nextCursor: null };
    return Response.json({ success: true, data });
  };
  try {
    const client = new clientModule.ExtensionClient(
      {
        apiOrigin: "https://api.grove.example",
        siteOrigin: "https://grove.example",
      },
      store(local),
      store(session),
      {
        bearer: async () => "fixture-token",
        signIn: async () => "fixture-token",
        invalidateCredentials: async () => {},
      },
    );
    await client.state(7);
    assert.ok(
      !urls.some((path) => path.includes("/pages")),
      "opening panel must not disclose current URL",
    );
    const beforeSource = urls.length;
    const source = {
      url: "https://example.com/origin",
      title: "Origin",
      capturedAt: new Date().toISOString(),
    };
    const automatic = await client.followSource(7, source);
    assert.deepEqual(automatic.source, source);
    await client.followSource(7, source);
    assert.equal(urls.length, beforeSource, "autofill is strictly local");
    await client.edit(7, { text: "First capture" });
    assert.deepEqual(
      (await client.followSource(7, null)).source,
      source,
      "typed draft retains originating page",
    );
    await assert.rejects(client.save(7));
    await client.edit(7, { text: "Newer edits" });
    const result = await client.save(7);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(result.draft?.text, "Newer edits");
    assert.equal(result.draft?.save?.status, "saved");
    assert.ok(!JSON.stringify([...local.values()]).includes("First capture"));
    assert.ok(!JSON.stringify([...local.values()]).includes("fixture-token"));
    write = false;
    await assert.rejects(client.save(7));
    assert.equal(writes.length, 2);
    await client.search({ query: "everywhere" });
    assert.deepEqual(searches, [
      { query: "everywhere", status: "active", limit: 20, sort: "relevance" },
    ]);
    const context = await client.context([{ id, version: 1 }]);
    assert.match(context.text, /Original note/);
    assert.match(context.text, /https:\/\/grove\.example\/app\/memories\//);
    note.version = 2;
    await assert.rejects(client.context([{ id, version: 1 }]), /changed/i);
    note.status = "archived";
    await assert.rejects(client.context([{ id, version: 2 }]), /unavailable/i);
    session.delete("identity");
    const beforeMissingIdentity = urls.length;
    await assert.rejects(client.followSource(7, source));
    assert.equal(
      urls.length,
      beforeMissingIdentity,
      "metadata never bootstraps authentication or calls the API",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
