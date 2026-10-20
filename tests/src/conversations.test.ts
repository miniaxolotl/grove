import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import {
  conversationCreateSchema,
  conversationPlanSchema,
  conversationTurnSchema,
} from "@lib/shared/conversations";
import type { Providers, Source } from "@lib/ai";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
assert(
  url && new URL(url).pathname.endsWith("_test"),
  "Use a disposable test database",
);
const authority = createDatabase(url);
const name = `grove_conversations_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, db: Knex, workerDb: Knex;
before(async () => {
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = (uri: string) => {
    const parsed = new URL(uri);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  admin = createDatabase(target(url));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  await Promise.all([db?.destroy(), workerDb?.destroy(), admin?.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
  await authority.destroy();
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture() {
  const subject = `chat_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const behavior = {
    intent: "find" as "find" | "edit" | "merge" | "create",
    references: [] as string[],
    calls: [] as { sources: Source[]; context: unknown }[],
    wait: undefined as (() => Promise<void>) | undefined,
    invalid: false,
    fail: false,
  };
  const providers: Providers = {
    generation: {
      profile: "chat-fixture",
      generate: async (schema, _instructions, sources, options) => {
        behavior.calls.push({ sources, context: options?.context });
        if (Object.is(schema, conversationPlanSchema))
          return schema.parse({
            query: "garden",
            intent: behavior.intent,
            references: behavior.references,
          });
        await behavior.wait?.();
        if (behavior.fail) throw new Error("unavailable");
        const refs = sources.map(({ id, version }) => ({ id, version }));
        return schema.parse({
          message:
            behavior.intent === "find"
              ? "Here are your garden notes."
              : "Here’s a preview.",
          statements: sources.slice(0, 1).map((s) => ({
            text: s.content,
            sources: [
              {
                id: behavior.invalid ? randomUUID() : s.id,
                version: s.version,
              },
            ],
          })),
          proposal:
            behavior.intent === "find"
              ? null
              : {
                  kind: behavior.intent,
                  content: "# Garden\n\nWater the garden every morning.",
                  target: behavior.intent === "create" ? null : refs[0],
                  sources:
                    behavior.intent === "create"
                      ? []
                      : behavior.intent === "edit"
                        ? refs.slice(0, 1)
                        : refs.slice(0, 2),
                },
        });
      },
    },
  };
  const service = new MemoryService(
    db,
    "conversation-tests",
    undefined,
    providers,
  );
  const save = (content: string, rest = {}) =>
    service.remember(
      principal,
      rememberSchema.parse({
        operationId: randomUUID(),
        content,
        source: { agent: "website" },
        ...rest,
      }),
    );
  const create = (rest = {}) =>
    service.conversations.create(
      principal,
      conversationCreateSchema.parse({ id: randomUUID(), ...rest }),
    );
  return { service, principal, providers, behavior, save, create };
}
const turn = (query: string, expectedVersion = 0) =>
  conversationTurnSchema.parse({ id: randomUUID(), query, expectedVersion });

test("durable conversation context, exact source references, replay and tenant boundaries", async () => {
  const { service, principal, providers, behavior, save, create } =
    await fixture();
  const note = await save("# Garden\n\nWater the garden in the morning.");
  const chat = await create();
  const request = turn("Find my garden plan");
  const first = await service.conversations.turn(principal, chat.id, request);
  assert.equal(first.turns[0]!.result!.sources[0]!.id, note.id);
  const count = behavior.calls.length;
  assert.deepEqual(
    await service.conversations.turn(principal, chat.id, request),
    first,
  );
  assert.equal(
    behavior.calls.length,
    count,
    "lost response must not cause a second generation",
  );
  await assert.rejects(
    service.conversations.turn(principal, chat.id, {
      ...request,
      query: "different",
    }),
    /conversation changed/,
  );
  behavior.intent = "edit";
  behavior.references = [note.id];
  const edited = await service.conversations.turn(
    principal,
    chat.id,
    turn("Make that note shorter", 1),
  );
  assert.match(
    JSON.stringify(behavior.calls.at(-1)?.context),
    /Find my garden plan/,
  );
  assert.equal(edited.turns[1]!.result!.proposal!.target!.id, note.id);
  const reloaded = await new MemoryService(
    db,
    "conversation-tests",
    undefined,
    providers,
  ).conversations.get(principal, chat.id);
  assert.deepEqual(reloaded, edited);
  const other = await fixture();
  assert.equal(
    (await service.conversations.list(other.principal)).items.length,
    0,
  );
  await assert.rejects(
    service.conversations.get(other.principal, chat.id),
    /not found/,
  );
  await assert.rejects(
    service.conversations.apply(other.principal, chat.id, edited.turns[1]!.id),
    /not found/,
  );
  assert.equal(
    (await db("conversation_turns")).length,
    0,
    "pooled connections must not retain tenant context",
  );
  await tenant(db, other.principal.accountId, async (trx) =>
    assert.equal((await trx("conversations").where({ id: chat.id })).length, 0),
  );
});

test("merge applies atomically, preserves originals and lifetimes, and undo is version-fenced", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  const a = await save("Garden watering plan", { retentionDays: 7 });
  const b = await save("Garden planting plan");
  behavior.intent = "merge";
  const chat = await create();
  const proposed = await service.conversations.turn(
    principal,
    chat.id,
    turn("Merge my garden plans"),
  );
  const message = proposed.turns[0]!;
  const proposal = message.result!.proposal!;
  const applied = await service.conversations.apply(
    principal,
    chat.id,
    message.id,
  );
  assert.equal(applied.turns[0]!.result!.proposal!.status, "applied");
  const target = await service.get(principal, proposal.target!.id);
  const original = await service.get(
    principal,
    [a, b].find((n) => n.id !== target.id)!.id,
  );
  assert.equal(target.version, 2);
  assert.equal(original.status, "archived");
  assert.equal((await service.get(principal, a.id)).expiresAt, a.expiresAt);
  await service.conversations.apply(principal, chat.id, message.id);
  assert.equal((await service.get(principal, target.id)).version, 2);
  const undone = await service.conversations.apply(
    principal,
    chat.id,
    message.id,
    true,
  );
  assert.equal(undone.turns[0]!.result!.proposal!.status, "undone");
  assert.equal((await service.get(principal, a.id)).content, a.content);
  assert.equal((await service.get(principal, b.id)).status, "active");
  const second = await create();
  const next = await service.conversations.turn(
    principal,
    second.id,
    turn("Merge these garden notes"),
  );
  await service.conversations.apply(principal, second.id, next.turns[0]!.id);
  const current = await service.get(principal, a.id);
  await save("A newer garden decision", {
    id: a.id,
    expectedVersion: current.version,
  });
  await assert.rejects(
    service.conversations.apply(principal, second.id, next.turns[0]!.id, true),
    /notes changed/,
  );
  assert.equal(
    (await service.get(principal, a.id)).content,
    "A newer garden decision",
  );
});

test("conversation HTTP routes validate bodies, paginate privately and export saved history", async () => {
  const { service, principal, create, save } = await fixture();
  const auth = new Authentication(db, {
    verify: async (token) => ({
      subject:
        token === "owner" ? principal.subject : `other_${principal.subject}`,
      type: "session",
      sessionId: `session_${token}`,
    }),
  });
  const app = createApp({
    memories: service,
    auth,
    origin: "http://localhost",
    siteUrl: "http://localhost",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
  });
  const headers = {
    authorization: "Bearer owner",
    "content-type": "application/json",
  };
  assert.equal((await app.request("/v1/conversations")).status, 401);
  assert.equal(
    (
      await app.request("/v1/conversations", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: randomUUID(), ownerId: randomUUID() }),
      })
    ).status,
    400,
  );
  const chat = await create();
  await save("Garden notes for export");
  const sent = await app.request(`/v1/conversations/${chat.id}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(turn("Find the garden notes")),
  });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).data.turns.length, 1);
  const foreign = await app.request(`/v1/conversations/${chat.id}`, {
    headers: { authorization: "Bearer other" },
  });
  assert.equal(foreign.status, 404);
  const key = await service.grant(
    principal,
    {
      name: "Connected agent",
      capabilities: ["memory:read", "memory:write"],
      personal: true,
      allProjects: true,
      projectIds: [],
    },
    { key: true },
  );
  for (const path of ["/v1/conversations", `/v1/conversations/${chat.id}`]) {
    assert.equal(
      (
        await app.request(path, {
          headers: { authorization: `Bearer ${key.secret}` },
        })
      ).status,
      403,
    );
  }
  for (let index = 0; index < 30; index++) await create();
  const first = (
    await (await app.request("/v1/conversations", { headers })).json()
  ).data;
  const second = (
    await (
      await app.request(`/v1/conversations?after=${first.nextCursor}`, {
        headers,
      })
    ).json()
  ).data;
  assert.equal(first.items.length, 30);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert(
    !first.items.some((item: { id: string }) => item.id === second.items[0].id),
  );
  // Export authorizes bounded pages rather than charging one request per chat.
  await admin("conversations").insert(
    Array.from({ length: 190 }, () => ({
      id: randomUUID(),
      accountId: principal.accountId,
      scope: JSON.stringify({ includePersonal: false }),
    })),
  );
  const exported = await app.request("/v1/account/export", { headers });
  const records = (await exported.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.filter((r) => r.type === "conversation").length, 221);
  assert.equal(
    records.find((r) => r.id === chat.id).turns[0].question,
    "Find the garden notes",
  );
});

test("stale merge previews never partially change notes, scoped retrieval excludes other notebooks", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  const project = await service.project(principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  const a = await save("Garden seeds", { projectId: project.id });
  const b = await save("Garden watering", { projectId: project.id });
  const outside = await save("Garden private journal");
  behavior.intent = "merge";
  const chat = await create({ projectId: project.id });
  const result = await service.conversations.turn(
    principal,
    chat.id,
    turn("Merge the garden notes"),
  );
  assert(!result.turns[0]!.result!.sources.some((n) => n.id === outside.id));
  await save("Garden seeds updated elsewhere", {
    id: b.id,
    expectedVersion: 1,
    projectId: project.id,
  });
  await assert.rejects(
    service.conversations.apply(principal, chat.id, result.turns[0]!.id),
    /notes changed/,
  );
  assert.equal((await service.get(principal, a.id)).version, 1);
  assert.equal((await service.get(principal, a.id)).status, "active");
});

test("in-flight replies fence changed sources, retry failed turns and reject invented citations", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  const note = await save("Garden plan");
  const chat = await create();
  const entered = deferred(),
    release = deferred();
  behavior.wait = async () => {
    entered.resolve();
    await release.promise;
  };
  const request = turn("Find garden notes");
  const promise = service.conversations.turn(principal, chat.id, request);
  await entered.promise;
  await assert.rejects(
    service.conversations.turn(principal, chat.id, request),
    /still working/,
  );
  await assert.rejects(
    service.conversations.turn(principal, chat.id, turn("another", 1)),
    /current reply/,
  );
  await save("Garden plan updated", { id: note.id, expectedVersion: 1 });
  release.resolve();
  await assert.rejects(promise, /notes changed/);
  assert.equal(
    (await service.conversations.get(principal, chat.id)).turns[0]!.status,
    "failed",
  );
  behavior.wait = undefined;
  behavior.invalid = true;
  await assert.rejects(
    service.conversations.turn(principal, chat.id, request),
    /generation_invalid_citation/,
  );
  behavior.invalid = false;
  const recovered = await service.conversations.turn(
    principal,
    chat.id,
    request,
  );
  assert.equal(recovered.turns.length, 1);
  assert.equal(recovered.turns[0]!.result!.sources[0]!.version, 2);
});

test("conversation replies recheck cancellation, provider settings and session revocation after inference", async () => {
  for (const change of [
    "cancel",
    "settings",
    "profile",
    "revoke",
    "delete",
  ] as const) {
    const { service, principal, behavior, save, create } = await fixture();
    principal.sessionId = `session_${randomUUID()}`;
    await save("Garden plan");
    const chat = await create();
    const entered = deferred(),
      release = deferred();
    const controller = new AbortController();
    behavior.wait = async () => {
      entered.resolve();
      await release.promise;
    };
    const request = turn("Find garden notes");
    const pending = service.conversations.turn(
      principal,
      chat.id,
      request,
      controller.signal,
    );
    const rejected = assert.rejects(pending);
    await entered.promise;
    if (change === "cancel") controller.abort();
    if (change === "settings")
      await service.settings(principal, {
        captureEnabled: true,
        recallEnabled: true,
        summariesEnabled: false,
      });
    if (change === "profile")
      service.providers.generation = {
        ...service.providers.generation!,
        profile: "another-provider",
      };
    if (change === "revoke")
      await admin("session_revocations").insert({ id: principal.sessionId });
    if (change === "delete")
      await service.conversations.remove(principal, chat.id);
    release.resolve();
    await rejected;
    const row = await admin("conversation_turns")
      .where({ id: request.id })
      .first();
    assert(!row?.result, `${change} cannot persist the stale reply`);
  }
});

test("creation, deleted chats and account deletion retain no replayable content", async () => {
  const { service, principal, behavior, create } = await fixture();
  behavior.intent = "create";
  const chat = await create();
  const result = await service.conversations.turn(
    principal,
    chat.id,
    turn("Create a garden watering note"),
  );
  const applied = await service.conversations.apply(
    principal,
    chat.id,
    result.turns[0]!.id,
  );
  const noteId = applied.turns[0]!.result!.proposal!.applied![0]!.id;
  await service.conversations.apply(
    principal,
    chat.id,
    result.turns[0]!.id,
    true,
  );
  assert.equal((await service.get(principal, noteId)).status, "archived");
  await service.conversations.remove(principal, chat.id);
  await assert.rejects(
    service.conversations.create(principal, {
      id: chat.id,
      includePersonal: false,
    }),
    /not found/,
  );
  await assert.rejects(
    service.conversations.get(principal, chat.id),
    /not found/,
  );
  assert.equal(
    (await admin("conversation_turns").where({ conversationId: chat.id }))
      .length,
    0,
  );
  const next = await create();
  await service.conversations.turn(
    principal,
    next.id,
    turn("Save a garden plan"),
  );
  await service.deleteAccount(principal);
  await new MemoryService(workerDb, "conversation-tests").maintenance(
    async () => {},
  );
  assert.equal(
    (await admin("conversations").where({ accountId: principal.accountId }))
      .length,
    0,
  );
  assert.equal(
    (
      await admin("conversation_turns").where({
        accountId: principal.accountId,
      })
    ).length,
    0,
  );
});
