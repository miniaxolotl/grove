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
    else data = { items: [], nextCursor: null };
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
    await client.edit(7, { text: "First capture" });
    let pageReads = 0;
    const currentPage = async () => {
      pageReads++;
      return {
        url: "https://source.example/first",
        title: "Original page",
        capturedAt: new Date().toISOString(),
      };
    };
    await assert.rejects(client.save(7, currentPage));
    await client.edit(7, { text: "Newer edits" });
    const result = await client.save(7, async () => {
      pageReads++;
      return {
        url: "https://other.example/",
        title: "Other page",
        capturedAt: new Date().toISOString(),
      };
    });
    assert.equal(
      pageReads,
      1,
      "retry must not re-read or change the original page snapshot",
    );
    assert.equal(
      (writes[0] as { provenance: { url: string } }).provenance.url,
      "https://source.example/first",
    );
    assert.equal(
      (writes[0] as { content: string }).content,
      "First capture",
      "automatic provenance must not turn a personally written note into an external quotation",
    );
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(result.draft?.text, "Newer edits");
    assert.equal(result.draft?.save?.status, "saved");
    assert.ok(!JSON.stringify([...local.values()]).includes("First capture"));
    assert.ok(!JSON.stringify([...local.values()]).includes("fixture-token"));
    write = false;
    await assert.rejects(client.save(7));
    assert.equal(writes.length, 2);
    const context = await client.context([{ id, version: 1 }]);
    assert.match(context.text, /Original note/);
    assert.match(context.text, /https:\/\/grove\.example\/app\/memories\//);
    note.version = 2;
    await assert.rejects(client.context([{ id, version: 1 }]), /changed/i);
    note.status = "archived";
    await assert.rejects(client.context([{ id, version: 2 }]), /unavailable/i);
  } finally {
    globalThis.fetch = previous;
  }
});
