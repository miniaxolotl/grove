import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase, tenant } from "@lib/database";
import {
  MemoryService,
  sessionPrincipal,
  Tasks,
  runTask,
  exportHandlers,
  type ArtifactStore,
} from "@lib/memory";
import { Readable } from "node:stream";
import { createApp } from "../../packages/api/src/app.ts";
import {
  listSchema,
  rememberSchema,
  type Memory,
  type Page,
  type Principal,
} from "@lib/shared/contracts";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "custom-note-order-test-secret");
after(() => db.destroy());
type Placement = {
  operationId: string;
  expectedVersion: number;
  expectedState: string;
  projectId?: string | null;
  beforeId?: string;
  afterId?: string;
};
const organize = (owner: Principal, id: string, input: Placement) =>
  service.organizeNote(owner, id, input);
const list = async (owner: Principal, projectId?: string | null) =>
  (await service.list(
    owner,
    listSchema.parse({ sort: "custom", projectId, limit: 100 }),
  )) as Page<Memory> & { orderState: string };

async function fixture() {
  const subject = `custom_order_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const owner = sessionPrincipal(rows[0].id, subject);
  const notebook = await service.project(owner, {
    name: "Reference notebook",
    identity: randomUUID(),
  });
  const notes: Memory[] = [];
  for (const [index, projectId] of [
    null,
    null,
    null,
    notebook.id,
    notebook.id,
    notebook.id,
  ].entries())
    notes.push(
      await service.remember(
        owner,
        rememberSchema.parse({
          operationId: randomUUID(),
          content: `# Note ${index + 1}`,
          projectId,
          kind: "fact",
          source: { agent: "website" },
        }),
      ),
    );
  return { owner, notebook, notes };
}

test("All notes, Unfiled and notebook orders are independent and survive display sorting", async () => {
  const { owner, notebook, notes } = await fixture();
  const all = await list(owner);
  assert.equal(typeof all.orderState, "string");
  await organize(owner, notes[5].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: all.orderState,
    beforeId: notes[0].id,
  });
  assert.equal((await list(owner)).items[0].id, notes[5].id);
  assert.deepEqual(
    (await list(owner, null)).items.map((note) => note.id),
    notes.slice(0, 3).map((note) => note.id),
  );
  const scoped = await list(owner, notebook.id);
  await organize(owner, notes[4].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: scoped.orderState,
    projectId: notebook.id,
    beforeId: notes[3].id,
  });
  assert.deepEqual(
    (await list(owner, notebook.id)).items.map((note) => note.id),
    [notes[4].id, notes[3].id, notes[5].id],
  );
  await service.list(owner, listSchema.parse({ sort: "title_desc" }));
  assert.equal((await list(owner)).items[0].id, notes[5].id);
  assert.equal((await list(owner, null)).items[0].id, notes[0].id);
});

test("manual reorder replays its original receipt but rejects stale or changed operations", async () => {
  const { owner, notes } = await fixture();
  const page = await list(owner, null);
  const input = {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: page.orderState,
    projectId: null,
    beforeId: notes[0].id,
  };
  const receipt = await organize(owner, notes[2].id, input);
  assert.deepEqual(await organize(owner, notes[2].id, input), receipt);
  await assert.rejects(
    organize(owner, notes[1].id, { ...input, operationId: randomUUID() }),
    { code: "note_order_conflict" },
  );
  await assert.rejects(
    organize(owner, notes[2].id, { ...input, beforeId: notes[1].id }),
    { code: "operation_conflict" },
  );
});

test("manual reorder never edits content revisions or queues inference", async () => {
  const { owner, notes } = await fixture();
  const snapshot = () =>
    tenant(db, owner.accountId, async (trx) => ({
      revisions: await trx("memory_revisions").count("* as count").first(),
      jobs: await trx("jobs").count("* as count").first(),
      account: await trx("accounts").first("contentVersion"),
    }));
  const before = await snapshot();
  const page = await list(owner, null);
  await organize(owner, notes[2].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: page.orderState,
    projectId: null,
    beforeId: notes[0].id,
  });
  assert.deepEqual(await snapshot(), before);
  assert.equal((await service.get(owner, notes[2].id)).version, 1);
});

test("manual note order enforces owner, exact container and tenant isolation", async () => {
  const { owner, notes, notebook } = await fixture();
  const other = await fixture();
  const foreignState = await list(other.owner);
  await assert.rejects(
    organize(other.owner, notes[0].id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      expectedState: foreignState.orderState,
    }),
    { code: "not_found" },
  );
  const scoped = await list(owner, notebook.id);
  await assert.rejects(
    organize(owner, notes[0].id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      expectedState: scoped.orderState,
      projectId: notebook.id,
      beforeId: notes[3].id,
    }),
    { code: "not_found" },
  );
  await organize(owner, notes[5].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: scoped.orderState,
    projectId: notebook.id,
    beforeId: notes[3].id,
  });
  assert.equal(
    (
      await tenant(db, other.owner.accountId, (trx) =>
        trx("note_order_positions").select("memoryId"),
      )
    ).length,
    0,
  );
  await assert.rejects(
    organize(
      { ...owner, type: "key", connectionId: randomUUID() },
      notes[0].id,
      {
        operationId: randomUUID(),
        expectedVersion: 1,
        expectedState: scoped.orderState,
      },
    ),
    { code: "forbidden" },
  );
});

test("moves append to the new container but keep the independent All notes order", async () => {
  const { owner, notebook, notes } = await fixture();
  const before = await list(owner, null);
  await organize(owner, notes[2].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: before.orderState,
    projectId: null,
    beforeId: notes[0].id,
  });
  const all = (await list(owner)).items.map((note) => note.id);
  const moved = await service.moveMemories(owner, {
    operationId: randomUUID(),
    projectId: notebook.id,
    items: [{ id: notes[2].id, expectedVersion: 1 }],
  });
  assert.equal((await list(owner, notebook.id)).items.at(-1)?.id, notes[2].id);
  assert.deepEqual(
    (await list(owner)).items.map((note) => note.id),
    all,
  );
  await service.moveMemories(owner, {
    operationId: randomUUID(),
    projectId: null,
    items: [{ id: moved[0].id, expectedVersion: moved[0].version }],
  });
  assert.equal((await list(owner, null)).items.at(-1)?.id, notes[2].id);
  assert.deepEqual(
    (await list(owner)).items.map((note) => note.id),
    all,
  );
});

test("new notes append, archived ranks survive restoration and deleted notes stay absent", async () => {
  const { owner, notes } = await fixture();
  const initial = await list(owner);
  await organize(owner, notes[0].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: initial.orderState,
    afterId: notes[5].id,
  });
  const added = await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "# A newly written note",
      kind: "fact",
      source: { agent: "website" },
    }),
  );
  assert.equal((await list(owner)).items.at(-1)?.id, added.id);
  const expected = (await list(owner)).items.map((note) => note.id);
  const archived = await service.lifecycle(owner, notes[0].id, "archive", {
    operationId: randomUUID(),
    expectedVersion: 1,
  });
  assert(!(await list(owner)).items.some((note) => note.id === notes[0].id));
  await service.lifecycle(owner, archived.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: archived.version,
  });
  assert.deepEqual(
    (await list(owner)).items.map((note) => note.id),
    expected,
  );
  const current = await service.get(owner, notes[0].id);
  await service.forget(owner, {
    operationId: randomUUID(),
    items: [{ id: current.id, expectedVersion: current.version }],
  });
  assert(!(await list(owner)).items.some((note) => note.id === current.id));
});

test("automatic create and move append keys stay bounded through a numeric carry", async () => {
  const { owner, notebook, notes } = await fixture();
  const rank = `${"9".repeat(500)}.${"1".repeat(11)}`;
  assert.equal(rank.length, 512);
  await tenant(db, owner.accountId, (trx) =>
    trx("note_order_positions").insert([
      { accountId: owner.accountId, scope: "all", memoryId: notes[0].id, rank },
      {
        accountId: owner.accountId,
        scope: "unfiled",
        memoryId: notes[0].id,
        rank,
      },
      {
        accountId: owner.accountId,
        scope: notebook.id,
        memoryId: notes[3].id,
        rank,
      },
    ]),
  );
  const created = await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "# Bounded automatic append",
      kind: "fact",
      source: { agent: "website" },
    }),
  );
  const assertBounded = async (id: string) => {
    const positions = await tenant(db, owner.accountId, (trx) =>
      trx("note_order_positions")
        .where({ memoryId: id })
        .select(trx.raw("rank::text AS rank")),
    );
    assert(positions.length > 0);
    assert(
      positions.every(({ rank }) => rank.length <= 512),
      "automatic ranks must fit signed cursor positions",
    );
  };
  await assertBounded(created.id);
  await service.moveMemories(owner, {
    operationId: randomUUID(),
    projectId: notebook.id,
    items: [{ id: notes[1].id, expectedVersion: 1 }],
  });
  await assertBounded(notes[1].id);
  assert.equal((await list(owner, notebook.id)).items.at(-1)?.id, notes[1].id);
  assert.equal((await list(owner, null)).items.at(-1)?.id, created.id);
});

test("custom cursors retain exact numeric positions and reject changed membership", async () => {
  const { owner, notes } = await fixture();
  const input = listSchema.parse({ sort: "custom", limit: 2 });
  let page = await service.list(owner, input);
  const ids = page.items.map((note) => note.id);
  while (page.nextCursor) {
    page = await service.list(owner, { ...input, cursor: page.nextCursor });
    ids.push(...page.items.map((note) => note.id));
  }
  assert.deepEqual(
    ids,
    notes.map((note) => note.id),
  );
  const first = await service.list(owner, input);
  assert(first.nextCursor);
  await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "A later note",
      kind: "fact",
      source: { agent: "website" },
    }),
  );
  await assert.rejects(
    service.list(owner, { ...input, cursor: first.nextCursor }),
    { code: "stale_search" },
  );
});

test("concurrent note placements serialize and stale Undo never replaces a newer arrangement", async () => {
  const { owner, notes } = await fixture();
  const before = await list(owner);
  const inputs = [notes[4], notes[5]].map((note) => ({
    id: note.id,
    input: {
      operationId: randomUUID(),
      expectedVersion: 1,
      expectedState: before.orderState,
      beforeId: notes[0].id,
    },
  }));
  const outcomes = await Promise.allSettled(
    inputs.map(({ id, input }) => organize(owner, id, input)),
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const failed = outcomes.find(
    (outcome) => outcome.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(failed.reason.code, "note_order_conflict");
  const first = outcomes.find(
    (outcome) => outcome.status === "fulfilled",
  ) as PromiseFulfilledResult<Awaited<ReturnType<typeof organize>>>;
  await organize(owner, notes[2].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: first.value.state,
    beforeId: notes[0].id,
  });
  const current = (await list(owner)).items.map((note) => note.id);
  await assert.rejects(
    organize(owner, first.value.id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      expectedState: first.value.state,
      ...first.value.undo,
    }),
    { code: "note_order_conflict" },
  );
  assert.deepEqual(
    (await list(owner)).items.map((note) => note.id),
    current,
  );
});

test("dense positions fail atomically before exceeding bounded cursor keys and endpoints stay usable", async () => {
  const { owner, notes } = await fixture();
  await tenant(db, owner.accountId, (trx) =>
    trx("note_order_positions").insert([
      {
        accountId: owner.accountId,
        scope: "all",
        memoryId: notes[0].id,
        rank: `0.${"0".repeat(510)}1`,
      },
      {
        accountId: owner.accountId,
        scope: "all",
        memoryId: notes[1].id,
        rank: `0.${"0".repeat(510)}2`,
      },
    ]),
  );
  const initial = await list(owner);
  await assert.rejects(
    organize(owner, notes[2].id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      expectedState: initial.orderState,
      beforeId: notes[1].id,
    }),
    { code: "note_order_conflict" },
  );
  assert.deepEqual(
    (await list(owner)).items.map((note) => note.id),
    initial.items.map((note) => note.id),
  );
  await organize(owner, notes[2].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: initial.orderState,
  });
  assert.equal((await list(owner)).items.at(-1)?.id, notes[2].id);
});

test("HTTP note organization has strict bounded input, replay and owner-only access", async () => {
  const { owner, notes } = await fixture();
  let principal = owner;
  const app = createApp({
    memories: service,
    auth: { principal: async () => principal },
    origin: "https://api.example.test",
    siteUrl: "https://grove.example.test",
    issuer: "https://clerk.example.test",
    webhookSecret: "unused",
    ready: async () => {},
  });
  const initial = await list(owner);
  const input = {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: initial.orderState,
    beforeId: notes[0].id,
  };
  const post = (body: unknown) =>
    app.request(`/v1/memories/${notes[2].id}/organize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ ...input, afterId: notes[1].id })).status, 400);
  assert.equal((await post({ ...input, expectedState: "forged" })).status, 400);
  assert.equal((await post({ ...input, extra: true })).status, 400);
  assert.equal((await post(input)).status, 200);
  assert.equal((await post(input)).status, 200);
  principal = { ...owner, type: "key", connectionId: randomUUID() };
  assert.equal((await post(input)).status, 403);
});

test("account exports retain exact custom ranks and are invalidated by reordering", async () => {
  const { owner, notes } = await fixture();
  const initial = await list(owner);
  await organize(owner, notes[2].id, {
    operationId: randomUUID(),
    expectedVersion: 1,
    expectedState: initial.orderState,
    beforeId: notes[0].id,
  });
  const files = new Map<string, Buffer>();
  const store: ArtifactStore = {
    async write(key, data) {
      if (Buffer.isBuffer(data)) files.set(key, data);
      else {
        const chunks: Buffer[] = [];
        for await (const chunk of data) chunks.push(Buffer.from(chunk));
        files.set(key, Buffer.concat(chunks));
      }
    },
    async read(key) {
      return Readable.from(files.get(key)!);
    },
    async remove(key) {
      files.delete(key);
    },
  };
  const worker = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
  try {
    const tasks = new Tasks(service, true);
    const task = await tasks.export(owner, {
      id: randomUUID(),
      includeDescendants: false,
    });
    for (let attempt = 0; attempt < 30; attempt++)
      if (
        !(await runTask(worker, exportHandlers(worker, store), { id: task.id }))
      )
        break;
    const artifact = await tasks.artifact(owner, task.id);
    const records = files
      .get(artifact.key)!
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const exported = records.filter((row) => row.type === "note");
    assert.equal(exported.length, notes.length);
    assert(
      exported.every(
        (row) =>
          row.customOrder?.version === 1 &&
          typeof row.customOrder.all === "string" &&
          typeof row.customOrder.container === "string",
      ),
    );
    // Compare exact decimal strings in PostgreSQL, never lossy JSON numbers.
    const order = await tenant(db, owner.accountId, (trx) =>
      trx.raw(
        'SELECT id FROM jsonb_to_recordset(?::jsonb) AS n(id uuid, "customOrder" jsonb) ORDER BY ("customOrder"->>\'all\')::numeric,id',
        [JSON.stringify(exported)],
      ),
    );
    assert.deepEqual(
      order.rows.map((row: { id: string }) => row.id),
      (await list(owner)).items.map((note) => note.id),
    );
    const current = await list(owner);
    await organize(owner, notes[1].id, {
      operationId: randomUUID(),
      expectedVersion: 1,
      expectedState: current.orderState,
      beforeId: notes[2].id,
    });
    assert.equal((await tasks.get(owner, task.id)).error, "export_changed");
  } finally {
    await worker.destroy();
  }
});
