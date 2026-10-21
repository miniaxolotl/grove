import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema } from "@lib/shared/contracts";
import {
  connectionQuerySchema,
  groundRelationship,
  type ConnectionLevel,
} from "@lib/shared/relationships";
import {
  connectionSource,
  currentRelationshipProfile,
  relationHash,
  relationshipTable,
} from "../../lib/memory/src/relationship-data.ts";
import { MemoryModel } from "@lib/database";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable database required");
const admin = createDatabase(url);
const db = createDatabase(process.env.TEST_DATABASE_URL!);
const workerDb = createDatabase(process.env.TEST_WORKER_DATABASE_URL!);
const accounts: string[] = [];
before(() => admin.migrate.latest());
after(async () => {
  for (const id of accounts) {
    await admin("accounts").where({ id }).update({ status: "deleting" });
  }
  await new MemoryService(
    workerDb,
    "relationship-tests-secret-32-characters",
  ).maintenance(async () => {});
  await Promise.all([db.destroy(), workerDb.destroy(), admin.destroy()]);
});
const input = (content: string, rest = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...rest });
async function fixture() {
  const subject = `relationships_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  accounts.push(principal.accountId);
  const generation = {
    profile: `generation-${randomUUID()}`,
    generate: async <T>() => {
      throw new Error("Unexpected inference");
      return {} as T;
    },
  };
  const service = new MemoryService(
    db,
    "relationship-tests-secret-32-characters",
    undefined,
    { generation },
  );
  const worker = new MemoryService(workerDb, service.cursorSecret, undefined, {
    generation,
  });
  return { principal, service, worker };
}
async function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  ids: string[],
  level: ConnectionLevel = "note",
) {
  return tenant(db, f.principal.accountId, async (trx) => {
    const notes = (await MemoryModel.query(trx).whereIn("id", ids)).sort(
      (a, b) =>
        (level === "note" ? a.id : a.projectId!).localeCompare(
          level === "note" ? b.id : b.projectId!,
        ),
    );
    const assessment = {
      relationship:
        level === "note" ? ("complementary" as const) : ("connected" as const),
      reason: "Both describe the same trip; one adds lodging plans.",
      basis:
        level === "note"
          ? ("additional_context" as const)
          : ("shared_goal" as const),
      direction: "both" as const,
      evidence: notes.map((n) => ({
        id: n.id,
        version: n.version,
        quote: n.content,
      })),
    };
    const leftId = level === "note" ? notes[0].id : notes[0].projectId!;
    const rightId = level === "note" ? notes[1].id : notes[1].projectId!;
    const leftVersion =
      level === "note"
        ? notes[0].version
        : (await trx("projects").where({ id: leftId }).first()).contentVersion;
    const rightVersion =
      level === "note"
        ? notes[1].version
        : (await trx("projects").where({ id: rightId }).first()).contentVersion;
    const evidence = groundRelationship(
      assessment,
      level,
      [connectionSource(notes[0])],
      [connectionSource(notes[1])],
    );
    const [row] = await trx(relationshipTable(level))
      .insert({
        accountId: f.principal.accountId,
        leftId,
        rightId,
        leftVersion,
        rightVersion,
        profile: currentRelationshipProfile(f.service.providers),
        revision: relationHash([leftId, rightId, leftVersion, rightVersion]),
        assessment: JSON.stringify({
          ...assessment,
          evidence,
          coverage: {
            from: { total: 1, examined: 1, supporting: 1 },
            to: { total: 1, examined: 1, supporting: 1 },
          },
          breadth: "thread",
        }),
      })
      .returning("*");
    return row;
  });
}
test("canonical reads are symmetric, tenant-isolated, and review replay/undo is version-fenced", async () => {
  const f = await fixture(),
    other = await fixture();
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip: stay near the station."),
  );
  const b = await f.service.remember(
    f.principal,
    input("October Kyoto trip: reserve a hotel for three nights."),
  );
  const row = await seed(f, [a.id, b.id]);
  const list = (id: string) =>
    f.service.relationships.list(
      f.principal,
      connectionQuerySchema.parse({ level: "note", endpointId: id }),
    );
  assert.deepEqual((await list(a.id)).items, (await list(b.id)).items);
  assert.equal(
    (
      await other.service.relationships.list(
        other.principal,
        connectionQuerySchema.parse({ level: "note" }),
      )
    ).items.length,
    0,
  );
  await tenant(db, other.principal.accountId, async (trx) => {
    assert.equal((await trx("memory_relationships").select("*")).length, 0);
    await assert.rejects(
      trx("memory_relationships").insert({ ...row, id: randomUUID() }),
      /row-level security/,
    );
  });
  const review = {
    operationId: randomUUID(),
    expectedRevision: row.revision,
    expectedReviewVersion: 0,
    dismissed: true,
  };
  const result = await f.service.relationships.review(
    f.principal,
    "note",
    row.id,
    review,
  );
  assert.deepEqual(
    await f.service.relationships.review(f.principal, "note", row.id, review),
    result,
  );
  assert.equal((await list(b.id)).items.length, 0);
  await assert.rejects(
    f.service.relationships.review(f.principal, "note", row.id, {
      ...review,
      operationId: randomUUID(),
      dismissed: false,
    }),
    { code: "relationship_changed" },
  );
  await f.service.relationships.review(f.principal, "note", row.id, {
    ...review,
    operationId: randomUUID(),
    expectedReviewVersion: result.reviewVersion,
    dismissed: false,
  });
  assert.equal((await list(a.id)).items.length, 1);
  await f.service.remember(
    f.principal,
    input("October trip is now cancelled.", {
      id: a.id,
      expectedVersion: a.version,
    }),
  );
  assert.equal((await list(b.id)).items.length, 0);
  await assert.rejects(
    f.service.relationships.review(f.principal, "note", row.id, review),
    { code: "relationship_changed" },
  );
});

test("notebook claims invalidate on uncited changes; scoped grants reveal neither hidden endpoints nor counts", async () => {
  const f = await fixture();
  const p = await f.service.project(f.principal, {
    name: "Itinerary",
    identity: randomUUID(),
  });
  const q = await f.service.project(f.principal, {
    name: "Budget",
    identity: randomUUID(),
    parentId: p.id,
  });
  const a = await f.service.remember(
    f.principal,
    input("Kyoto trip in October.", { projectId: p.id }),
  );
  const b = await f.service.remember(
    f.principal,
    input("Kyoto lodging budget in October.", { projectId: q.id }),
  );
  const row = await seed(f, [a.id, b.id], "notebook");
  const all = await f.service.relationships.list(
    f.principal,
    connectionQuerySchema.parse({ level: "notebook", endpointId: p.id }),
  );
  assert.equal(all.items[0].id, row.id);
  const { connection } = await f.service.grant(
    f.principal,
    {
      name: "Parent only",
      capabilities: ["memory:read"],
      personal: false,
      allProjects: false,
      projectIds: [p.id],
    },
    { key: true },
  );
  const key = {
    ...f.principal,
    type: "key" as const,
    connectionId: connection.id,
    capabilities: ["memory:read" as const],
  };
  const limited = await f.service.relationships.list(
    key,
    connectionQuerySchema.parse({ level: "notebook", limit: 1 }),
  );
  assert.deepEqual(limited, { items: [], nextCursor: null, status: "ready" });
  await assert.rejects(
    f.service.relationships.list(
      key,
      connectionQuerySchema.parse({ level: "notebook", endpointId: q.id }),
    ),
    { code: "not_found" },
  );
  await assert.rejects(
    f.service.relationships.review(key, "notebook", row.id, {
      operationId: randomUUID(),
      expectedRevision: row.revision,
      expectedReviewVersion: 0,
      dismissed: true,
    }),
    { code: "forbidden" },
  );
  await f.service.remember(
    f.principal,
    input("An uncited change to the itinerary.", { projectId: p.id }),
  );
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "notebook" }),
      )
    ).items.length,
    0,
  );
});
