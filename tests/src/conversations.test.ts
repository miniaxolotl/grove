import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { createDatabase, tenant, type Knex } from "@lib/database";
import {
  MemoryService,
  sessionPrincipal,
  exportHandlers,
  runTask,
  configureBillingQuotas,
  type ArtifactStore,
} from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import { billingLimits } from "@lib/shared/billing";
import {
  conversationCreateSchema,
  conversationPlanSchema,
  conversationTurnSchema,
  conversationResponseSchema,
} from "@lib/shared/conversations";
import { createGenerationProvider, type Providers, type Source } from "@lib/ai";
import { generationConfigSchema } from "@lib/shared/models";
import { Authentication } from "../../packages/api/src/auth.ts";
import { createApp } from "../../packages/api/src/app.ts";
import { withTelemetry, type TelemetrySink } from "@lib/telemetry/context";
import { policy } from "../../lib/config/src/index.ts";

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
    intent: "find" as
      | "find"
      | "edit"
      | "merge"
      | "create"
      | "organize"
      | "archive"
      | "restore"
      | "delete",
    references: [] as string[],
    calls: [] as { sources: Source[]; context: unknown }[],
    schemas: [] as { safeParse: (value: unknown) => { success: boolean } }[],
    wait: undefined as (() => Promise<void>) | undefined,
    invalid: false,
    fail: false,
    research: [] as {
      provider: "exa" | "tavily";
      query: string;
      urls: string[];
    }[],
    webStatements: [] as { text: string; urls: string[] }[],
    organization: [] as unknown[],
    lifecycle: [] as unknown[],
    organizeAfter: null as string | null,
  };
  const providers: Providers = {
    generation: {
      profile: "chat-fixture",
      generate: async (schema, _instructions, sources, options) => {
        behavior.calls.push({ sources, context: options?.context });
        behavior.schemas.push(schema);
        if (Object.is(schema, conversationPlanSchema))
          return schema.parse({
            query: "garden",
            intent: behavior.intent,
            references: behavior.references,
            research: behavior.research,
            organizeAfter: behavior.organizeAfter,
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
          webStatements: behavior.webStatements,
          organization: behavior.organization,
          ...(behavior.lifecycle.length
            ? { lifecycle: behavior.lifecycle }
            : {}),
          proposals: [
            "find",
            "organize",
            "archive",
            "restore",
            "delete",
          ].includes(behavior.intent)
            ? []
            : [
                {
                  kind: behavior.intent,
                  content: "# Garden\n\nWater the garden every morning.",
                  target: behavior.intent === "create" ? [] : refs.slice(0, 1),
                  sources:
                    behavior.intent === "create"
                      ? []
                      : behavior.intent === "edit"
                        ? refs.slice(0, 1)
                        : refs.slice(0, 2),
                },
              ],
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

test("unchanged failed-turn retries reuse the validated plan", async () => {
  const f = await fixture();
  await f.save("Garden watering schedule");
  const chat = await f.create(),
    input = turn("Find garden notes");
  f.behavior.fail = true;
  await assert.rejects(
    f.service.conversations.turn(f.principal, chat.id, input),
  );
  f.behavior.fail = false;
  await f.service.conversations.turn(f.principal, chat.id, input);
  assert.equal(
    f.behavior.schemas.filter((s) => s === conversationPlanSchema).length,
    1,
  );
});

test("recent exact research is reused across questions in the same account", async () => {
  const f = await fixture();
  let calls = 0;
  f.service.research = {
    exa: {
      search: async () => {
        calls++;
        return [];
      },
      extract: async () => [],
    },
  };
  f.behavior.research = [{ provider: "exa", query: "compost guide", urls: [] }];
  for (const question of ["Find compost guidance", "Research garden compost"]) {
    const chat = await f.create();
    await f.service.conversations.turn(f.principal, chat.id, turn(question));
  }
  assert.equal(calls, 1);
});

test("read-only conversation generation reuses exact evidence but not changed notes", async () => {
  const f = await fixture();
  const note = await f.save("Garden needs morning water");
  const ask = async () => {
    const chat = await f.create();
    return f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Find garden notes"),
    );
  };
  await ask();
  const reused = await ask();
  assert.equal(reused.turns[0].result?.usage?.status, "cached", "identical question, context and evidence need no paid planning or answering");
  assert.equal(
    f.behavior.schemas.filter((s) => s !== conversationPlanSchema).length,
    1,
  );
  await f.save("Garden needs evening water", {
    id: note.id,
    expectedVersion: note.version,
  });
  await ask();
  assert.equal(
    f.behavior.schemas.filter((s) => s !== conversationPlanSchema).length,
    2,
  );
});

test("explicit source refresh replaces cached research without repeating paid work on ready-turn replay", async () => {
  const f = await fixture();
  let calls = 0;
  f.service.research = {
    exa: {
      search: async () => {
        calls++;
        return [];
      },
      extract: async () => [],
    },
  };
  f.behavior.research = [{ provider: "exa", query: "compost guide", urls: [] }];
  const first = await f.create();
  await f.service.conversations.turn(
    f.principal,
    first.id,
    turn("Research garden compost"),
  );
  const second = await f.create();
  const refresh = conversationTurnSchema.parse({
    ...turn("Research garden compost"),
    refreshSources: true,
  });
  await f.service.conversations.turn(f.principal, second.id, refresh);
  await f.service.conversations.turn(f.principal, second.id, refresh);
  assert.equal(calls, 2);
  const third = await f.create();
  await f.service.conversations.turn(
    f.principal,
    third.id,
    turn("Research garden compost"),
  );
  assert.equal(
    calls,
    2,
    "ordinary requests use the explicitly refreshed evidence",
  );
});

test("changed notes immediately stop supporting a stored read-only answer without deleting conversation history", async () => {
  const f = await fixture();
  const note = await f.save("Garden needs morning water");
  const chat = await f.create();
  await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Find garden notes"),
  );
  await f.save("Garden needs evening water", {
    id: note.id,
    expectedVersion: note.version,
  });
  const read = await f.service.conversations.get(f.principal, chat.id);
  assert.equal(read.turns.length, 1);
  assert.deepEqual(read.turns[0].result!.statements, []);
  assert.match(read.turns[0].result!.message, /changed|expired/i);
  const stored = await admin("conversation_turns")
    .where({ conversationId: chat.id })
    .first();
  assert.equal(
    stored.result.statements.length,
    1,
    "retained history is not physically deleted",
  );
});

test("Ask moves existing notebooks with atomic version checks and exact hierarchy Undo", async () => {
  const f = await fixture();
  const root = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  const target = await f.service.project(f.principal, {
    name: "Home",
    identity: randomUUID(),
  });
  f.behavior.intent = "organize";
  f.behavior.organization = [
    {
      notebookMoves: [
        { id: root.id, version: root.version, destination: target.id },
      ],
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Move Garden inside Home"),
  );
  assert.equal(
    (await f.service.projects(f.principal)).find((n) => n.id === root.id)
      ?.parentId,
    null,
  );
  chat = await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
  );
  assert.equal(
    (await f.service.projects(f.principal)).find((n) => n.id === root.id)
      ?.parentId,
    target.id,
  );
  await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
    true,
  );
  assert.equal(
    (await f.service.projects(f.principal)).find((n) => n.id === root.id)
      ?.parentId,
    null,
  );
});

test("Ask note lifecycle previews archive, restore and delete only after Apply", async () => {
  const f = await fixture();
  let note = await f.save("Garden pruning checklist", { retentionDays: 14 });
  const originalExpiry = note.expiresAt;
  for (const action of ["archive", "restore", "delete"] as const) {
    f.behavior.intent = action;
    f.behavior.lifecycle = [
      {
        action,
        notes: [{ id: note.id, version: note.version }],
        notebooks: [],
      },
    ];
    let chat = await f.create();
    chat = await f.service.conversations.turn(
      f.principal,
      chat.id,
      turn(`${action} my garden note`),
    );
    assert.equal(
      (await f.service.get(f.principal, note.id)).version,
      note.version,
    );
    await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
    await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
    if (action === "delete") {
      await assert.rejects(f.service.get(f.principal, note.id), {
        code: "not_found",
      });
      await assert.rejects(
        f.service.conversations.apply(
          f.principal,
          chat.id,
          chat.turns[0].id,
          true,
        ),
        { code: "not_undoable" },
      );
    } else {
      note = await f.service.get(f.principal, note.id);
      assert.equal(note.status, action === "archive" ? "archived" : "active");
      if (action === "restore") {
        await f.service.conversations.apply(
          f.principal,
          chat.id,
          chat.turns[0].id,
          true,
        );
        note = await f.service.get(f.principal, note.id);
        assert.equal(note.status, "archived");
        assert.equal(note.expiresAt, originalExpiry);
      }
    }
  }
});

test("Ask notebook lifecycle validates complete subtree snapshots and supports archive Undo", async () => {
  const f = await fixture();
  const parent = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  const child = await f.service.project(f.principal, {
    name: "Seeds",
    identity: randomUUID(),
    parentId: parent.id,
  });
  const note = await f.save("Garden seeds", { projectId: child.id });
  f.behavior.intent = "archive";
  f.behavior.lifecycle = [
    {
      action: "archive",
      notes: [],
      notebooks: [{ id: parent.id, version: parent.version }],
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Archive Garden and its contents"),
  );
  await f.save("Garden new note", { projectId: child.id });
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id),
    { code: "version_conflict" },
  );
  assert.equal((await f.service.get(f.principal, note.id)).status, "active");
  chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Archive Garden and its contents"),
  );
  await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
  assert.equal((await f.service.get(f.principal, note.id)).status, "archived");
  await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
    true,
  );
  assert.equal((await f.service.get(f.principal, note.id)).status, "active");
});

test("Ask rejects lifecycle changes in ordinary answers and stale note batches", async () => {
  const f = await fixture();
  const note = await f.save("Garden safety checklist");
  f.behavior.lifecycle = [
    {
      action: "delete",
      notes: [{ id: note.id, version: note.version }],
      notebooks: [],
    },
  ];
  let chat = await f.create();
  await assert.rejects(
    f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Find my garden notes"),
    ),
  );
  assert.equal((await f.service.get(f.principal, note.id)).status, "active");
  f.behavior.intent = "delete";
  chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Delete the garden note"),
  );
  await f.save("Garden edited", { id: note.id, expectedVersion: note.version });
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id),
    { code: "sources_changed" },
  );
  assert.equal(
    (await f.service.get(f.principal, note.id)).content,
    "Garden edited",
  );
});

test("Ask notebook move Undo rejects a cycle introduced after Apply", async () => {
  const f = await fixture();
  const oldParent = await f.service.project(f.principal, {
    name: "Original",
    identity: randomUUID(),
  });
  const folder = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
    parentId: oldParent.id,
  });
  f.behavior.intent = "organize";
  f.behavior.organization = [
    {
      notebookMoves: [
        { id: folder.id, version: folder.version, destination: null },
      ],
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Move Garden to the root"),
  );
  await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
  await f.service.project(
    f.principal,
    {
      name: oldParent.name,
      identity: oldParent.identity,
      expectedVersion: oldParent.version,
      parentId: folder.id,
    },
    oldParent.id,
  );
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id, true),
  );
  assert.equal(
    (await f.service.projects(f.principal)).find((n) => n.id === folder.id)
      ?.parentId,
    null,
  );
});

test("Ask can undo moving an existing notebook into a new notebook", async () => {
  const f = await fixture();
  const folder = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  f.behavior.intent = "organize";
  f.behavior.organization = [
    {
      notebooks: [{ key: "home", name: "Home" }],
      notebookMoves: [
        { id: folder.id, version: folder.version, destination: "new:home" },
      ],
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Create Home and move Garden into it"),
  );
  await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
  await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
    true,
  );
  const folders = await f.service.projects(f.principal);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].parentId, null);
});

test("Ask lifecycle rejects overlapping targets and keeps an entire stale note batch unchanged", async () => {
  const f = await fixture();
  const folder = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  const first = await f.save("Garden first", { projectId: folder.id });
  const second = await f.save("Garden second", { projectId: folder.id });
  f.behavior.intent = "delete";
  f.behavior.lifecycle = [
    {
      action: "delete",
      notes: [{ id: first.id, version: first.version }],
      notebooks: [{ id: folder.id, version: folder.version }],
    },
  ];
  let chat = await f.create();
  await assert.rejects(
    f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Delete the Garden notebook and note"),
    ),
    { code: "sources_changed" },
  );
  f.behavior.lifecycle = [
    {
      action: "delete",
      notes: [first, second].map(({ id, version }) => ({ id, version })),
      notebooks: [],
    },
  ];
  chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Delete both garden notes"),
  );
  await f.save("Garden second changed", {
    id: second.id,
    expectedVersion: second.version,
    projectId: folder.id,
  });
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id),
    { code: "sources_changed" },
  );
  assert.equal(
    (await f.service.get(f.principal, first.id)).version,
    first.version,
  );
});

test("Ask notebook lifecycle delete retains hidden source history and cannot be undone", async () => {
  const f = await fixture();
  const folder = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  const note = await f.save("Garden reference", { projectId: folder.id });
  f.behavior.intent = "delete";
  f.behavior.lifecycle = [
    {
      action: "delete",
      notes: [],
      notebooks: [{ id: folder.id, version: folder.version }],
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Delete the Garden notebook and all its contents"),
  );
  await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
  await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
  await assert.rejects(f.service.get(f.principal, note.id), {
    code: "not_found",
  });
  assert.equal(
    (await admin("memory_revisions").where({ memoryId: note.id })).length,
    1,
  );
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id, true),
    { code: "not_undoable" },
  );
});

test("Ask notebook lifecycle cannot expand a notebook-scoped conversation into children", async () => {
  const f = await fixture();
  const folder = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  await f.service.project(f.principal, {
    name: "Seeds",
    identity: randomUUID(),
    parentId: folder.id,
  });
  f.behavior.intent = "archive";
  f.behavior.lifecycle = [
    {
      action: "archive",
      notes: [],
      notebooks: [{ id: folder.id, version: folder.version }],
    },
  ];
  const chat = await f.create({ projectId: folder.id });
  await assert.rejects(
    f.service.conversations.turn(f.principal, chat.id, turn("Archive Garden")),
    { code: "sources_changed" },
  );
});

test("Ask lifecycle rejects notebook targets not supplied to the generation snapshot", async () => {
  const f = await fixture();
  const started = deferred(),
    release = deferred();
  f.behavior.intent = "delete";
  f.behavior.wait = async () => {
    started.resolve();
    await release.promise;
  };
  const chat = await f.create();
  const response = f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Delete the Garden notebook"),
  );
  await started.promise;
  const unseen = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  f.behavior.lifecycle = [
    {
      action: "delete",
      notes: [],
      notebooks: [{ id: unseen.id, version: unseen.version }],
    },
  ];
  release.resolve();
  await assert.rejects(response, { code: "sources_changed" });
});

test("Ask notebook organization cannot move or rename a notebook outside conversation scope", async () => {
  const f = await fixture();
  const folder = await f.service.project(f.principal, {
    name: "Garden",
    identity: randomUUID(),
  });
  const outside = await f.service.project(f.principal, {
    name: "Home",
    identity: randomUUID(),
  });
  f.behavior.intent = "organize";
  for (const changes of [
    {
      notebookMoves: [
        { id: outside.id, version: outside.version, destination: folder.id },
      ],
    },
    {
      renames: [{ id: outside.id, version: outside.version, name: "Changed" }],
    },
  ]) {
    f.behavior.organization = [changes];
    const chat = await f.create({ projectId: folder.id });
    await assert.rejects(
      f.service.conversations.turn(
        f.principal,
        chat.id,
        turn("Organize this notebook"),
      ),
      { code: "sources_changed" },
    );
  }
});

async function seedNotes(accountId: string, count: number) {
  await admin.raw(
    `INSERT INTO memories(account_id, content, kind, source)
     SELECT ?::uuid, 'Capacity fixture ' || n, 'fact', '{}'::jsonb
     FROM generate_series(1, ?::integer) n`,
    [accountId, count],
  );
}

test("conversation creates enforce the account note limit while edits and Undo remain available", async () => {
  const f = await fixture();
  const note = await f.save("Garden watering schedule");
  await seedNotes(f.principal.accountId, policy.maxMemories - 1);
  await assert.rejects(f.save("Another note"), { code: "storage_limit" });
  f.behavior.intent = "create";
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Create a garden note"),
  );
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id),
    { code: "storage_limit" },
  );
  assert.equal(
    (await f.service.conversations.get(f.principal, chat.id)).turns[0].result
      ?.proposal?.status,
    "proposed",
  );

  f.behavior.intent = "edit";
  chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Edit my garden note"),
  );
  await f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id);
  assert.equal((await f.service.get(f.principal, note.id)).version, 2);
  await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
    true,
  );
  assert.equal(
    (await f.service.get(f.principal, note.id)).content,
    note.content,
  );
  const other = await fixture();
  await other.save("A separate account still has capacity");
});

test("an organization batch exceeding remaining note capacity rolls back every write", async () => {
  const f = await fixture();
  const note = await f.save("Garden compost planning");
  f.behavior.intent = "organize";
  f.behavior.organization = [
    {
      notebooks: [{ key: "garden", name: "Garden", parent: null }],
      renames: [],
      moves: [
        { id: note.id, version: note.version, destination: "new:garden" },
      ],
      notes: [
        { content: "Compost recipe", destination: "new:garden" },
        { content: "Planting schedule", destination: "new:garden" },
      ],
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("File my garden note and create compost and planting notes"),
  );
  await seedNotes(f.principal.accountId, policy.maxMemories - 2);
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id),
    { code: "storage_limit" },
  );
  assert.deepEqual(await f.service.projects(f.principal), []);
  const unchanged = await f.service.get(f.principal, note.id);
  assert.equal(unchanged.version, note.version);
  assert.equal(unchanged.projectId, null);
  assert.equal(
    Number(
      (
        await admin("memories")
          .where({ accountId: f.principal.accountId })
          .count("id as count")
          .first()
      )?.count,
    ),
    policy.maxMemories - 1,
  );
  assert.equal(
    (await f.service.conversations.get(f.principal, chat.id)).turns[0].result
      ?.organization?.status,
    "proposed",
  );
});

test("concurrent conversation creates share the final note slot and replay and Undo work at capacity", async () => {
  const f = await fixture();
  f.behavior.intent = "create";
  const chats = [];
  for (let index = 0; index < 2; index++) {
    const chat = await f.create();
    chats.push(
      await f.service.conversations.turn(
        f.principal,
        chat.id,
        turn("Create a garden note"),
      ),
    );
  }
  await seedNotes(f.principal.accountId, policy.maxMemories - 1);
  const results = await Promise.allSettled(
    chats.map((chat) =>
      f.service.conversations.apply(f.principal, chat.id, chat.turns[0].id),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.equal(rejected?.reason.code, "storage_limit");
  const result = results.find((r) => r.status === "fulfilled")!;
  const chat = result.value;
  const applied = chat.turns[0].result!.proposal!.applied!;
  const replay = await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
  );
  assert.deepEqual(replay.turns[0].result!.proposal!.applied, applied);
  await assert.rejects(f.save("Ordinary creation shares the quota"), {
    code: "storage_limit",
  });
  await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
    true,
  );
  assert.equal(
    (await f.service.get(f.principal, applied[0].id)).status,
    "archived",
  );
  await assert.rejects(f.save("Archived notes still count"), {
    code: "storage_limit",
  });
});

test("account tool choices persist through a fresh connection and session without creating chats", async () => {
  const f = await fixture();
  const makeApp = (database: Knex, service: MemoryService) =>
    createApp({
      memories: service,
      auth: new Authentication(database, {
        verify: async (token) => ({
          subject:
            token === "other"
              ? `other_${f.principal.subject}`
              : f.principal.subject,
          type: "session",
          sessionId: token,
        }),
      }),
      origin: "http://localhost",
      siteUrl: "http://localhost",
      issuer: "https://clerk.example.test",
      webhookSecret: "whsec_dGVzdA==",
      ready: async () => {},
    });
  const app = makeApp(db, f.service);
  const headers = {
    authorization: "Bearer first-session",
    "content-type": "application/json",
  };
  const patch = (input: unknown, authHeaders = headers) =>
    app.request("/v1/ask-tools", {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify(input),
    });
  assert.equal(
    (await app.request("/v1/ask-tools", { method: "PATCH", body: "{}" }))
      .status,
    401,
  );
  for (const invalid of [
    {},
    { exa: "false" },
    { accountId: randomUUID(), exa: false },
  ])
    assert.equal((await patch(invalid)).status, 400);
  await f.service.settings(f.principal, { captureEnabled: false });
  const saved = await patch({ exa: false });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).data.defaults, {
    exa: false,
    tavily: false,
    organize: true,
  });
  // Unrelated switches from another tab are merged, not replaced by a stale full snapshot.
  assert.equal((await patch({ tavily: true })).status, 200);
  assert.equal(
    (await patch({ exa: false })).status,
    200,
    "lost-response retry is safe",
  );
  assert.equal(
    (await f.service.conversations.list(f.principal)).items.length,
    0,
  );
  assert.equal((await f.service.me(f.principal)).captureEnabled, false);
  const target = new URL(process.env.TEST_DATABASE_URL!);
  target.pathname = `/${name}`;
  const freshDb = createDatabase(target.href);
  try {
    const freshService = new MemoryService(freshDb, "conversation-tests");
    const freshApp = makeApp(freshDb, freshService);
    const read = await freshApp.request("/v1/ask-tools", {
      headers: { authorization: "Bearer restarted-session" },
    });
    const expected = { exa: false, tavily: true, organize: true };
    assert.deepEqual((await read.json()).data.defaults, expected);
    const chat = await freshService.conversations.create(
      f.principal,
      conversationCreateSchema.parse({ id: randomUUID() }),
    );
    assert.deepEqual(chat.tools, expected);
    const other = await freshApp.request("/v1/ask-tools", {
      headers: { authorization: "Bearer other" },
    });
    assert.deepEqual((await other.json()).data.defaults, {
      exa: true,
      tavily: false,
      organize: true,
    });
    const key = await f.service.grant(
      f.principal,
      {
        name: "Agent",
        capabilities: ["memory:read"],
        personal: true,
        allProjects: true,
        projectIds: [],
      },
      { key: true },
    );
    assert.equal(
      (
        await patch(
          { exa: true },
          { ...headers, authorization: `Bearer ${key.secret}` },
        )
      ).status,
      403,
    );
  } finally {
    await freshDb.destroy();
  }
});

test("conversation tool saves merge only the changed default and stale saves are atomic", async () => {
  const f = await fixture();
  const other = await fixture();
  const old = await f.create();
  const current = await f.create();
  await f.service.conversations.configureTools(f.principal, old.id, {
    expectedVersion: 0,
    tools: { exa: false, tavily: true, organize: true },
    saveDefault: true,
  });
  const input = {
    expectedVersion: 0,
    tools: { exa: true, tavily: false, organize: false },
    saveDefault: true,
    defaultPatch: { organize: false },
  };
  const saved = await f.service.conversations.configureTools(
    f.principal,
    current.id,
    input,
  );
  assert.deepEqual(saved.tools, input.tools);
  assert.deepEqual((await f.create()).tools, {
    exa: false,
    tavily: true,
    organize: false,
  });
  assert.deepEqual(
    (await f.service.conversations.get(f.principal, old.id)).tools,
    { exa: false, tavily: true, organize: true },
  );
  await assert.rejects(
    f.service.conversations.configureTools(f.principal, current.id, {
      ...input,
      tools: { ...input.tools, organize: true },
      defaultPatch: { organize: true },
    }),
    { code: "conversation_changed" },
  );
  await assert.rejects(
    f.service.conversations.configureTools(other.principal, current.id, {
      ...input,
      expectedVersion: 1,
    }),
    { code: "not_found" },
  );
  await assert.rejects(
    f.service.conversations.configureTools(f.principal, current.id, {
      ...input,
      expectedVersion: 1,
      defaultPatch: { exa: false },
    }),
  );
  assert.deepEqual((await f.create()).tools, {
    exa: false,
    tavily: true,
    organize: false,
  });
});

test("conversation tools persist choices, enforce disabled providers and retain web citations", async () => {
  const { service, principal, behavior, create } = await fixture();
  assert.equal(typeof service.conversations.configureTools, "function");
  let calls = 0;
  service.research = {
    exa: {
      search: async () => {
        calls++;
        return [
          {
            id: "https://example.org/compost",
            url: "https://example.org/compost",
            title: "Compost guide",
            text: "Compost feeds soil",
            provider: "exa",
            kind: "search",
            retrievedAt: new Date().toISOString(),
          },
        ];
      },
      extract: async () => [],
    },
  };
  let chat = await create();
  chat = await service.conversations.configureTools(principal, chat.id, {
    expectedVersion: 0,
    tools: { exa: false, tavily: false, organize: true },
  });
  behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  await service.conversations.turn(
    principal,
    chat.id,
    turn("Research compost"),
  );
  assert.equal(calls, 0);
  assert.equal(
    (await service.conversations.get(principal, chat.id)).tools.exa,
    false,
  );
  chat = await create();
  behavior.webStatements = [
    { text: "Compost feeds soil", urls: ["https://example.org/compost"] },
  ];
  const result = await service.conversations.turn(
    principal,
    chat.id,
    turn("Research compost"),
  );
  assert.equal(calls, 1);
  assert.equal(
    result.turns[0].result?.webSources?.[0].url,
    "https://example.org/compost",
  );
  assert.equal(
    result.turns[0].result?.webStatements?.[0].text,
    "Compost feeds soil",
  );
});

test("disabling and re-enabling research fences an in-flight provider result", async () => {
  const { service, principal, behavior, create } = await fixture();
  assert.equal(typeof service.conversations.configureTools, "function");
  const entered = deferred(),
    release = deferred();
  service.research = {
    exa: {
      search: async () => {
        entered.resolve();
        await release.promise;
        return [];
      },
      extract: async () => [],
    },
  };
  behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  const chat = await create();
  const running = service.conversations.turn(
    principal,
    chat.id,
    turn("Research compost"),
  );
  const rejected = assert.rejects(running);
  await entered.promise;
  await service.conversations.configureTools(principal, chat.id, {
    expectedVersion: 0,
    tools: { exa: false, tavily: false, organize: true },
  });
  await service.conversations.configureTools(principal, chat.id, {
    expectedVersion: 1,
    tools: { exa: true, tavily: false, organize: true },
  });
  release.resolve();
  await rejected;
  assert.equal(
    (await service.conversations.get(principal, chat.id)).turns[0].result,
    null,
  );
});

test("master Ask disable/re-enable during research cannot publish the old turn", async () => {
  const f = await fixture(),
    entered = deferred(),
    release = deferred();
  f.service.research = {
    exa: {
      search: async () => {
        entered.resolve();
        await release.promise;
        return [];
      },
      extract: async () => [],
    },
  };
  f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  const chat = await f.create();
  const running = f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Research compost"),
  );
  const rejected = assert.rejects(running);
  await entered.promise;
  await f.service.settings(f.principal, { askEnabled: false });
  await f.service.settings(f.principal, { askEnabled: true });
  release.resolve();
  await rejected;
});

test("notebook and note batches preview, apply atomically, replay and undo without removing later work", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  const note = await save("Garden compost planning");
  behavior.intent = "organize";
  behavior.organization = [
    {
      notebooks: [{ key: "garden", name: "Garden", parent: null }],
      renames: [],
      moves: [
        { id: note.id, version: note.version, destination: "new:garden" },
      ],
      notes: [
        { content: "# Compost\n\nUse compost.", destination: "new:garden" },
      ],
    },
  ];
  const chat = await create();
  const result = await service.conversations.turn(
    principal,
    chat.id,
    turn(
      "Create a Garden notebook, move my garden note into it and add a compost note",
    ),
  );
  assert.equal(result.turns[0].result?.organization?.status, "proposed");
  assert.deepEqual(
    result.turns[0].result?.statements,
    [],
    "Grove owns unapplied batch descriptions",
  );
  assert.equal((await service.projects(principal)).length, 0);
  const applied = await service.conversations.apply(
    principal,
    chat.id,
    result.turns[0].id,
  );
  const notebooks = await service.projects(principal);
  assert.equal(notebooks.length, 1);
  assert.equal(
    (await service.get(principal, note.id)).projectId,
    notebooks[0].id,
  );
  assert.equal(applied.turns[0].result?.organization?.status, "applied");
  await service.conversations.apply(principal, chat.id, result.turns[0].id);
  assert.equal((await service.projects(principal)).length, 1);
  await service.conversations.apply(
    principal,
    chat.id,
    result.turns[0].id,
    true,
  );
  assert.equal((await service.get(principal, note.id)).projectId, null);
  assert.equal((await service.projects(principal)).length, 0);
});

test("organization follow-ups identify created notes and use fresh versions for edits", async () => {
  const f = await fixture();
  const original = await f.save("Garden planning");
  f.behavior.intent = "organize";
  const notes = [
    { content: "# Compost\n\nUse leaves.", destination: "new:garden" },
    { content: "# Planting\n\nSow beans.", destination: "new:garden" },
  ];
  f.behavior.organization = [
    {
      notebooks: [{ key: "garden", name: "Garden", parent: null }],
      renames: [],
      moves: [
        {
          id: original.id,
          version: original.version,
          destination: "new:garden",
        },
      ],
      notes,
    },
  ];
  let chat = await f.create();
  chat = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("File my garden note and create compost and planting notes"),
  );
  chat = await f.service.conversations.apply(
    f.principal,
    chat.id,
    chat.turns[0].id,
  );
  const organization = chat.turns[0].result!.organization!;
  const created = await f.service.get(f.principal, organization.applied![2].id);
  const updated = await f.save("# Planting\n\nSow peas instead.", {
    id: created.id,
    expectedVersion: created.version,
    projectId: created.projectId,
  });
  f.behavior.intent = "edit";
  f.behavior.organization = [];
  f.behavior.references = [created.id];
  const edited = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Make the planting note you just created shorter", 1),
  );
  const context = f.behavior.calls.at(-2)!.context as {
    conversation: {
      organization: {
        status: string;
        notes: { id: string; version: number; content: string }[];
      };
    }[];
  };
  assert.equal(context.conversation[0].organization.status, "applied");
  assert.deepEqual(
    context.conversation[0].organization.notes.map(
      ({ id, version, content }) => ({
        id,
        version,
        content,
      }),
    ),
    notes.map((note, index) => ({
      ...organization.applied![index + 1],
      content: note.content,
    })),
    "each new note must be paired with its own applied ID, after the moved notes",
  );
  const result = edited.turns[1].result!;
  assert.deepEqual(result.proposal!.target, {
    id: updated.id,
    version: updated.version,
  });
  assert.equal(result.sources[0].content, updated.content);
  await f.save("A newer planting decision", {
    id: updated.id,
    expectedVersion: updated.version,
    projectId: updated.projectId,
  });
  await assert.rejects(
    f.service.conversations.apply(f.principal, chat.id, edited.turns[1].id),
    { code: "sources_changed" },
  );
});

test("organization follow-up references cannot revive undone notes or escape notebook scope", async () => {
  for (const change of ["undo", "move"] as const) {
    const f = await fixture();
    const project = await f.service.project(f.principal, {
      name: "Garden",
      identity: randomUUID(),
    });
    f.behavior.intent = "organize";
    f.behavior.organization = [
      {
        notebooks: [],
        renames: [],
        moves: [],
        notes: [{ content: "Compost recipe", destination: project.id }],
      },
    ];
    let chat = await f.create({ projectId: project.id });
    chat = await f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Create a compost note in this notebook"),
    );
    chat = await f.service.conversations.apply(
      f.principal,
      chat.id,
      chat.turns[0].id,
    );
    const created = chat.turns[0].result!.organization!.applied![0];
    if (change === "undo")
      await f.service.conversations.apply(
        f.principal,
        chat.id,
        chat.turns[0].id,
        true,
      );
    else
      await f.save("Compost recipe", {
        id: created.id,
        expectedVersion: created.version,
        projectId: null,
      });
    f.behavior.intent = "find";
    f.behavior.organization = [];
    f.behavior.references = [created.id];
    const next = await f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Show the note you just created", 1),
    );
    assert.deepEqual(next.turns[1].result!.sources, [], change);
    assert.equal(next.turns[1].result!.proposal, null, change);
  }
});

test("a stale organization move rolls back notebook creation and organization off prevents Apply", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  const note = await save("Garden planning");
  behavior.intent = "organize";
  behavior.organization = [
    {
      notebooks: [{ key: "garden", name: "Garden", parent: null }],
      renames: [],
      moves: [
        { id: note.id, version: note.version, destination: "new:garden" },
      ],
      notes: [],
    },
  ];
  const chat = await create();
  const result = await service.conversations.turn(
    principal,
    chat.id,
    turn("Organize my garden notes into a Garden notebook"),
  );
  await service.conversations.configureTools(principal, chat.id, {
    expectedVersion: 0,
    tools: { exa: true, tavily: false, organize: false },
  });
  await assert.rejects(
    service.conversations.apply(principal, chat.id, result.turns[0].id),
  );
  assert.equal((await service.projects(principal)).length, 0);
  await service.conversations.configureTools(principal, chat.id, {
    expectedVersion: 1,
    tools: { exa: true, tavily: false, organize: true },
  });
  await tenant(db, principal.accountId, (trx) =>
    trx("memories")
      .where({ id: note.id })
      .update({ version: note.version + 1 }),
  );
  await assert.rejects(
    service.conversations.apply(principal, chat.id, result.turns[0].id),
  );
  assert.equal((await service.projects(principal)).length, 0);
});

test("Pro research passes the legacy daily ceiling but stops at its advertised allowance", async () => {
  const f = await fixture();
  let calls = 0;
  f.service.research = {
    exa: {
      search: async () => {
        calls++;
        return [];
      },
      extract: async () => [],
    },
  };
  f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  await tenant(db, f.principal.accountId, async (trx) => {
    await trx("billing_customers").insert({
      accountId: f.principal.accountId,
      customerId: `cus_${f.principal.accountId}`,
    });
    await trx("billing_subscriptions").insert({
      accountId: f.principal.accountId,
      customerId: `cus_${f.principal.accountId}`,
      id: `sub_${f.principal.accountId}`,
      priceId: "price_pro",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
    });
  });
  await admin("research_account_usage").insert({
    accountId: f.principal.accountId,
    day: admin.raw("(now() AT TIME ZONE 'UTC')::date"),
    calls: 99,
  });
  configureBillingQuotas(db, {
    enabled: async () => true,
    priceIds: ["price_pro"],
  });
  try {
    for (let index = 0; index < 2; index++) {
      const chat = await f.create();
      await f.service.conversations.turn(
        f.principal,
        chat.id,
        turn("Research compost"),
      );
    }
    assert.equal(calls, 1);
  } finally {
    configureBillingQuotas(db, { enabled: async () => false, priceIds: [] });
  }
});

test("monthly Free research usage stops paid research without stopping an ordinary answer", async () => {
  const f = await fixture();
  let calls = 0;
  f.service.research = {
    exa: {
      search: async () => {
        calls++;
        return [];
      },
      extract: async () => [],
    },
  };
  f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  await admin("research_account_usage").insert({
    accountId: f.principal.accountId,
    day: admin.raw("(now() AT TIME ZONE 'UTC')::date"),
    calls: billingLimits.free.research.monthly,
  });
  configureBillingQuotas(db, { enabled: async () => true, priceIds: [] });
  try {
    const chat = await f.create();
    const response = await f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Research compost"),
    );
    assert.equal(calls, 0);
    assert.equal(response.turns[0].result?.researchIncomplete, true);
  } finally {
    configureBillingQuotas(db, { enabled: async () => false, priceIds: [] });
  }
});

test("unlimited research bypasses per-plan and legacy account caps but retains installation spending", async () => {
  const f = await fixture();
  let calls = 0;
  f.service.research = {
    exa: {
      search: async () => {
        calls++;
        return [];
      },
      extract: async () => [],
    },
  };
  f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  await admin("account_administration").insert({
    accountId: f.principal.accountId,
    access: "unlimited",
  });
  await admin("research_account_usage").insert({
    accountId: f.principal.accountId,
    day: admin.raw("(now() AT TIME ZONE 'UTC')::date"),
    calls: billingLimits.pro.research.monthly,
  });
  const current = await admin("research_global_usage")
    .whereRaw("month=date_trunc('month',now() AT TIME ZONE 'UTC')::date")
    .first();
  f.service.researchLimits = {
    dailyCalls: 1,
    monthlyMicrodollars: Number(current?.microdollars ?? 0) + 4000,
  };
  configureBillingQuotas(db, { enabled: async () => false, priceIds: [] });
  for (let index = 0; index < 2; index++) {
    const chat = await f.create();
    await f.service.conversations.turn(
      f.principal,
      chat.id,
      turn("Research compost"),
    );
  }
  assert.equal(
    calls,
    1,
    "unlimited grants keep the independent global provider-spend bound",
  );
});
test("research reservations serialize across accounts and successful tools are reused after a failed reply", async () => {
  const a = await fixture(),
    b = await fixture();
  let calls = 0;
  const provider = {
    search: async () => {
      calls++;
      return [];
    },
    extract: async () => [],
  };
  const used = Number(
    (await admin("research_global_usage").first())?.microdollars ?? 0,
  );
  for (const f of [a, b]) {
    f.service.research = { exa: provider };
    f.service.researchLimits = {
      dailyCalls: 1,
      monthlyMicrodollars: used + 4000,
    };
    f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  }
  const chats = await Promise.all([a.create(), b.create()]);
  const results = await Promise.all([
    a.service.conversations.turn(
      a.principal,
      chats[0].id,
      turn("Research compost"),
    ),
    b.service.conversations.turn(
      b.principal,
      chats[1].id,
      turn("Research compost"),
    ),
  ]);
  assert.equal(calls, 1);
  assert.equal(
    results.filter((result) => result.turns[0].result?.researchIncomplete)
      .length,
    1,
  );
  await assert.rejects(
    tenant(db, a.principal.accountId, (trx) =>
      trx("research_global_usage").select("*"),
    ),
    /permission denied/,
  );
  const f = await fixture();
  f.service.research = { exa: provider };
  f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  f.behavior.fail = true;
  const chat = await f.create(),
    input = turn("Research compost");
  await assert.rejects(
    f.service.conversations.turn(f.principal, chat.id, input),
  );
  assert.equal(calls, 2);
  f.behavior.fail = false;
  await f.service.conversations.turn(f.principal, chat.id, input);
  assert.equal(
    calls,
    2,
    "completed tool calls are not billed again on reply retry",
  );
});

test("organization Undo refuses new notebook contents and concurrent destination changes", async () => {
  const f = await fixture();
  const note = await f.save("Garden planning");
  f.behavior.intent = "organize";
  f.behavior.organization = [
    {
      notebooks: [{ key: "garden", name: "Garden", parent: null }],
      renames: [],
      moves: [
        { id: note.id, version: note.version, destination: "new:garden" },
      ],
      notes: [],
    },
  ];
  const chat = await f.create();
  const result = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("File my garden note in a new Garden notebook"),
  );
  await f.service.conversations.apply(f.principal, chat.id, result.turns[0].id);
  const notebook = (await f.service.projects(f.principal))[0];
  const later = await f.save("New authored work", { projectId: notebook.id });
  await assert.rejects(
    f.service.conversations.apply(
      f.principal,
      chat.id,
      result.turns[0].id,
      true,
    ),
  );
  assert.equal(
    (await f.service.get(f.principal, later.id)).content,
    "New authored work",
  );
  assert.equal(
    (await f.service.get(f.principal, note.id)).projectId,
    notebook.id,
  );
});

test("organization continuation reaches notes beyond the first bounded batch", async () => {
  const f = await fixture();
  for (let index = 0; index < 55; index++) await f.save(`Garden note ${index}`);
  f.behavior.intent = "organize";
  f.behavior.organization = [
    {
      notebooks: [{ key: "garden", name: "Garden", parent: null }],
      renames: [],
      moves: [],
      notes: [],
    },
  ];
  const chat = await f.create();
  const first = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Organize my notes into a Garden notebook"),
  );
  const cursor = first.turns[0].result?.organization?.coverage.nextCursor;
  assert.equal(
    typeof cursor,
    "string",
    "bounded organization exposes a continuation",
  );
  f.behavior.organizeAfter = cursor!;
  const next = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Continue with the next batch", 1),
  );
  assert.equal(next.turns[1].result?.sources.length, 5);
  assert.equal(next.turns[1].result?.organization?.coverage.nextCursor, null);
  assert.equal(
    next.turns[1].result?.sources.some((n) =>
      first.turns[0].result?.sources.some((previous) => previous.id === n.id),
    ),
    false,
  );
});

test("partial page extraction is explicit rather than reported as complete research", async () => {
  const f = await fixture();
  f.service.research = {
    tavily: { search: async () => [], extract: async () => [] },
  };
  f.behavior.research = [
    { provider: "tavily", query: "", urls: ["https://example.org/article"] },
  ];
  const chat = await f.create();
  await f.service.conversations.configureTools(f.principal, chat.id, {
    expectedVersion: 0,
    tools: { exa: false, tavily: true, organize: true },
  });
  const result = await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Read this article"),
  );
  assert.equal(result.turns[0].result?.researchIncomplete, true);
});

test("generation schemas exclude competing action shapes and unavailable evidence", async () => {
  const f = await fixture();
  f.behavior.intent = "create";
  const chat = await f.create();
  await f.service.conversations.turn(
    f.principal,
    chat.id,
    turn("Create a garden note"),
  );
  const schema = f.behavior.schemas.at(-1)!;
  assert.equal(
    schema.safeParse({
      message: "Preview",
      statements: [],
      webStatements: [],
      proposals: [],
      organization: [
        {
          notebooks: [],
          renames: [],
          moves: [],
          notes: [{ content: "Garden", destination: null }],
        },
      ],
    }).success,
    false,
    "plain note requests cannot choose a notebook action wire shape",
  );
  assert.equal(
    schema.safeParse({
      message: "Answer",
      statements: [
        {
          text: "Invented citation",
          sources: [{ id: randomUUID(), version: 1 }],
        },
      ],
      webStatements: [],
      proposals: [],
      organization: [],
    }).success,
    false,
    "no note evidence means no note citation slots",
  );
});

test("organization wire responses normalize omitted empty fields but reject incomplete writes", () => {
  const schema = conversationResponseSchema("organize", true, false, true);
  const response = {
    message: "Preview",
    statements: [],
    organization: [
      {
        notebooks: [{ key: "garden", name: "Garden" }],
        renames: [],
        moves: [],
      },
    ],
  };
  assert.equal(schema.safeParse(response).success, true);
  const normalized = schema.parse(response);
  assert.equal(normalized.organization[0].notebooks[0].parent, null);
  assert.deepEqual(normalized.organization[0].notes, []);
  assert.equal(
    schema.safeParse({
      ...response,
      organization: [{ notes: [{ destination: null }] }],
    }).success,
    false,
  );
});

test("retry marks abandoned research activity failed before starting another call", async () => {
  const f = await fixture();
  f.behavior.research = [{ provider: "exa", query: "compost", urls: [] }];
  f.service.research = {
    exa: { search: async () => [], extract: async () => [] },
  };
  const chat = await f.create(),
    input = turn("Research compost");
  f.behavior.fail = true;
  await assert.rejects(
    f.service.conversations.turn(f.principal, chat.id, input),
  );
  await tenant(db, f.principal.accountId, (trx) =>
    trx("conversation_turns")
      .where({ id: input.id })
      .update({
        toolRuns: JSON.stringify([
          {
            key: "abandoned",
            provider: "tavily",
            operation: "search",
            status: "running",
            sources: [],
          },
        ]),
      }),
  );
  f.behavior.fail = false;
  const result = await f.service.conversations.turn(
    f.principal,
    chat.id,
    input,
  );
  assert.equal(
    result.turns[0].toolRuns?.find((run) => run.key === "abandoned")?.status,
    "failed",
  );
});

test("chat stays available with summaries off, while disabled chat blocks generation and Apply but permits Undo", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  await service.settings(principal, {
    notebookSummariesEnabled: false,
    personalSummaryEnabled: false,
    progressSummariesEnabled: false,
  });
  const note = await save("Garden plan");
  behavior.intent = "edit";
  const chat = await create();
  const result = await service.conversations.turn(
    principal,
    chat.id,
    turn("Shorten my garden note"),
  );
  assert.equal(result.turns[0].result?.proposal?.status, "proposed");
  assert.equal(behavior.calls.length, 2);
  await service.settings(principal, {
    askEnabled: false,
    personalSummaryEnabled: true,
  });
  await assert.rejects(
    service.conversations.apply(principal, chat.id, result.turns[0].id),
    /Enable Ask Grove/,
  );
  assert.equal((await service.get(principal, note.id)).version, 1);
  const another = await create();
  await service.conversations.turn(principal, another.id, turn("Find garden"));
  assert.equal(
    behavior.calls.length,
    2,
    "disabled chat makes no generation calls",
  );
  await service.settings(principal, { askEnabled: true });
  await service.conversations.apply(principal, chat.id, result.turns[0].id);
  await service.settings(principal, { askEnabled: false });
  await service.conversations.apply(
    principal,
    chat.id,
    result.turns[0].id,
    true,
  );
  assert.equal((await service.get(principal, note.id)).content, "Garden plan");
});

test("turning chat off and back on cannot publish an old in-flight reply", async () => {
  const { service, principal, behavior, save, create } = await fixture();
  await save("Garden plan");
  const chat = await create();
  const entered = deferred(),
    release = deferred();
  behavior.wait = async () => {
    entered.resolve();
    await release.promise;
  };
  const request = turn("Find garden notes");
  const running = service.conversations.turn(principal, chat.id, request);
  const rejected = assert.rejects(running);
  await entered.promise;
  await service.settings(principal, { askEnabled: false });
  await service.settings(principal, { askEnabled: true });
  release.resolve();
  await rejected;
  const stored = await service.conversations.get(principal, chat.id);
  assert.equal(stored.turns[0].status, "failed");
  assert.equal(stored.turns[0].result, null);
});

test("real tool transport completes greetings, retries invalid responses and normalizes creation previews", async () => {
  const { service, principal, create } = await fixture();
  let malformed: unknown = { message: "Hey!", statements: [], proposal: {} };
  let calls = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(body.messages[1].content);
    const properties = body.tools[0].function.parameters.properties;
    const creating = context.question.includes("Create");
    // Reproduce MiniMax's {} for a nullable object. An array-only tool contract
    // must handle absence without treating an empty or partial object as an edit.
    const output = properties.intent
      ? {
          query: context.question,
          intent: creating ? "create" : "answer",
          references: [],
        }
      : malformed || !properties.proposals
        ? (malformed ?? { message: "Hey!", statements: [], proposal: {} })
        : {
            message: creating
              ? "Created and saved your note."
              : "Hey! What’s on your mind?",
            statements: [],
            proposals: creating
              ? [
                  {
                    kind: "create",
                    target: [],
                    sources: [],
                    content: "# A small idea\n\nBring a notebook.",
                  },
                ]
              : [],
          };
    calls++;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    name: "record_result",
                    arguments: JSON.stringify(output),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  service.providers.generation = createGenerationProvider(
    generationConfigSchema.parse({
      provider: "minimax",
      model: "MiniMax-M3.1-Flash",
      baseUrl: `http://127.0.0.1:${address.port}`,
    }),
  );
  try {
    const chat = await create();
    const greeting = turn("# YO\n\nWhat’s popping?");
    for (const output of [
      malformed,
      { message: "Preview", statements: [], proposals: [{}] },
      {
        message: "Preview",
        statements: [],
        proposals: [
          {
            kind: "create",
            target: [{}],
            sources: [],
            content: "An incomplete action",
          },
        ],
      },
    ]) {
      malformed = output;
      await assert.rejects(
        service.conversations.turn(principal, chat.id, greeting),
        { code: "generation_invalid_response" },
      );
      const failed = (await service.conversations.get(principal, chat.id))
        .turns[0]!;
      assert.equal(failed.status, "failed");
      assert.equal(
        failed.result,
        null,
        "an incomplete action must never become a usable preview",
      );
    }
    malformed = null;
    const reply = await service.conversations.turn(
      principal,
      chat.id,
      greeting,
    );
    assert.equal(reply.turns.length, 1);
    assert.equal(reply.turns[0]!.status, "ready");
    assert.equal(reply.turns[0]!.result!.proposal, null);
    assert.deepEqual(reply.turns[0]!.result!.sources, []);
    assert.match(reply.turns[0]!.result!.message, /Hey!/);
    const completedCalls = calls;
    assert.deepEqual(
      await service.conversations.turn(principal, chat.id, greeting),
      reply,
    );
    assert.equal(
      calls,
      completedCalls,
      "reopening a completed reply must not regenerate it",
    );
    const preview = await service.conversations.turn(
      principal,
      chat.id,
      turn("Create a note: Bring a notebook.", 1),
    );
    assert.equal(preview.turns[1]!.result!.proposal!.kind, "create");
    assert.equal(preview.turns[1]!.result!.proposal!.target, null);
    assert.match(preview.turns[1]!.result!.message, /preview/i);
    assert.doesNotMatch(preview.turns[1]!.result!.message, /saved/i);
    assert.equal(
      (await service.list(principal, { status: "active", limit: 20 })).items
        .length,
      0,
      "a preview must not save a note",
    );
    await service.conversations.apply(principal, chat.id, preview.turns[1]!.id);
    assert.equal(
      (await service.list(principal, { status: "active", limit: 20 })).items[0]!
        .content,
      "# A small idea\n\nBring a notebook.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("chat conversions follow committed replies and applied creates, excluding failed or replayed turns", async () => {
  const { service, principal, behavior, create } = await fixture();
  const events: string[] = [];
  const sink: TelemetrySink = {
    capture(event) {
      events.push(event);
    },
    operation() {},
  };
  await withTelemetry(sink, async () => {
    behavior.intent = "create";
    const chat = await create();
    const input = turn("PRIVATE_CREATE");
    behavior.fail = true;
    await assert.rejects(service.conversations.turn(principal, chat.id, input));
    assert.equal(events.filter((e) => e === "chat_completed").length, 0);
    behavior.fail = false;
    const reply = await service.conversations.turn(principal, chat.id, input);
    await service.conversations.turn(principal, chat.id, input);
    assert.equal(events.filter((e) => e === "chat_completed").length, 1);
    assert.equal(events.filter((e) => e === "memory_created").length, 0);
    const turnId = reply.turns[0]!.id;
    await service.conversations.apply(principal, chat.id, turnId);
    await service.conversations.apply(principal, chat.id, turnId);
    await service.conversations.apply(principal, chat.id, turnId, true);
    assert.equal(events.filter((e) => e === "memory_created").length, 1);
  });
});

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
  const objects = new Map<string, Buffer>();
  const artifacts: ArtifactStore = {
    async write(key, data) {
      const chunks: Buffer[] = [];
      for await (const chunk of Buffer.isBuffer(data) ? [data] : data)
        chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
    },
    async read(key) {
      assert(objects.has(key));
      return Readable.from([objects.get(key)!]);
    },
    async remove(key) {
      objects.delete(key);
    },
  };
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
    artifacts,
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
  assert.equal((await app.request("/v1/ask-tools")).status, 401);
  const capabilities = await app.request("/v1/ask-tools", { headers });
  assert.equal(capabilities.status, 200);
  assert.equal((await capabilities.json()).data.defaults.organize, true);
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
  // Export pages run in the worker without spending the owner's HTTP quota.
  await admin("conversations").insert(
    Array.from({ length: 190 }, () => ({
      id: randomUUID(),
      accountId: principal.accountId,
      scope: JSON.stringify({ includePersonal: false }),
    })),
  );
  const requested = await app.request("/v1/exports", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: randomUUID() }),
  });
  assert.equal(requested.status, 202);
  const task = (await requested.json()).data;
  for (let i = 0; i < 30; i++)
    if (
      !(await runTask(workerDb, exportHandlers(workerDb, artifacts), {
        id: task.id,
      }))
    )
      break;
  const exported = await app.request(`/v1/tasks/${task.id}/download`, {
    headers,
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (
      await app.request(`/v1/tasks/${task.id}/download`, {
        headers: { authorization: "Bearer other" },
      })
    ).status,
    409,
  );
  const records = (await exported.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.filter((r) => r.type === "conversation").length, 221);
  assert.equal(
    records.find((r) => r.type === "conversation" && r.id === chat.id).tools
      .organize,
    true,
  );
  assert.equal(
    records.find((r) => r.type === "turn" && r.conversationId === chat.id)
      .question,
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

test("deleted chats and closed accounts retain history that cannot be read or replayed", async () => {
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
    1,
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
    (
      await admin("conversations")
        .where({ accountId: principal.accountId })
        .whereNull("deletedAt")
    ).length,
    0,
  );
  assert.equal(
    (
      await tenant(db, principal.accountId, (trx) =>
        trx("conversation_turns").where({
          accountId: principal.accountId,
        }),
      )
    ).length,
    0,
  );
});
