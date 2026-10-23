import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { createApp } from "../../packages/api/src/app.ts";
import type { Principal } from "@lib/shared/contracts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(url && new URL(url).pathname.endsWith("_test"));
const admin = createDatabase(url),
  db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(
  db,
  "history-search-secret-at-least-thirty-two-characters",
);
after(async () => {
  await Promise.all([admin.destroy(), db.destroy()]);
});
async function fixture() {
  const subject = `history_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const app = createApp({
    memories: service,
    auth: { principal: async () => principal },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  const search = (body: unknown) =>
    app.request("/v1/conversations/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  async function chat(
    title: string,
    questions: string[] = [],
    stamp = "2026-10-23T10:00:00.000001Z",
  ) {
    const id = randomUUID();
    await admin("conversations").insert({
      id,
      accountId: principal.accountId,
      title,
      scope: "{}",
      updatedAt: stamp,
    });
    for (const [index, question] of questions.entries())
      await admin("conversation_turns").insert({
        id: randomUUID(),
        accountId: principal.accountId,
        conversationId: id,
        position: index + 1,
        question,
        fingerprint: randomUUID(),
        status: "ready",
        result: JSON.stringify({
          message: "Private reply",
          statements: [],
          sources: [],
          proposal: null,
        }),
      });
    return id;
  }
  return { principal, search, chat };
}

test("history search finds titles and older questions with bounded previews and literal matching", async () => {
  const f = await fixture();
  const title = await f.chat("Garden planning", ["Spring planting"]);
  const question = await f.chat("Weekend", [
    "Review the GARDEN budget",
    "Book the train",
  ]);
  await f.chat("Unrelated", ["Recipes"]);
  const response = await f.search({ query: "garden" });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(
    new Set(data.items.map((item: { id: string }) => item.id)),
    new Set([title, question]),
  );
  assert.equal(
    data.items.find((item: { id: string }) => item.id === question).preview,
    "Review the GARDEN budget",
  );
  assert.equal(
    data.items.find((item: { id: string }) => item.id === question).turnCount,
    2,
  );
  assert(!JSON.stringify(data).includes("Private reply"));
  const special = await f.chat("100%_literal", ["Long ".repeat(1000)]);
  const literal = await (await f.search({ query: "%_" })).json();
  assert.deepEqual(
    literal.data.items.map((item: { id: string }) => item.id),
    [special],
  );
  assert(literal.data.items[0].preview.length <= 240);
  assert.equal((await f.search({ query: "x".repeat(201) })).status, 400);
  assert.equal((await f.search({ query: "", unknown: true })).status, 400);
});

test("history pages retain microsecond order and survive deletion of their cursor row", async () => {
  const f = await fixture();
  const ids = [];
  for (let index = 0; index < 35; index++)
    ids.push(
      await f.chat(
        `Journey ${index}`,
        [],
        `2026-10-23T10:00:00.${String(index).padStart(6, "0")}Z`,
      ),
    );
  const response = await f.search({});
  assert.equal(response.status, 200);
  const first = (await response.json()).data;
  assert.equal(first.items.length, 30);
  assert.deepEqual(
    first.items.map((item: { id: string }) => item.id),
    ids.slice(5).reverse(),
  );
  await service.conversations.remove(f.principal, first.items.at(-1).id);
  const next = (await (await f.search({ after: first.nextCursor })).json())
    .data;
  assert.deepEqual(
    next.items.map((item: { id: string }) => item.id),
    ids.slice(0, 5).reverse(),
  );
  assert.equal(next.nextCursor, null);
  assert.equal(
    (await f.search({ query: "different", after: first.nextCursor })).status,
    400,
  );
  assert.equal((await f.search({ after: first.nextCursor + "x" })).status, 400);
  const other = await fixture();
  assert.equal((await other.search({ after: first.nextCursor })).status, 400);
});

test("history search is owner-only and excludes deleted and foreign conversations", async () => {
  const f = await fixture(),
    other = await fixture();
  const id = await f.chat("Private title", ["Private question"]);
  await other.chat("Foreign title", ["Foreign question"]);
  const before = await f.search({});
  assert.equal(before.status, 200);
  assert.equal((await before.json()).data.items.length, 1);
  await service.conversations.remove(f.principal, id);
  assert.equal(
    (await (await f.search({ query: "Private" })).json()).data.items.length,
    0,
  );
  assert.equal(
    (await admin("conversation_turns").where({ conversationId: id })).length,
    1,
  );
  const issued = await service.grant(
    f.principal,
    {
      name: "Agent",
      capabilities: ["memory:read", "memory:write"],
      allProjects: true,
      personal: true,
      projectIds: [],
    },
    { key: true },
  );
  const agent: Principal = {
    ...f.principal,
    type: "key",
    connectionId: issued.connection.id,
  };
  const app = createApp({
    memories: service,
    auth: { principal: async () => agent },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  assert.equal(
    (
      await app.request("/v1/conversations/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
});
