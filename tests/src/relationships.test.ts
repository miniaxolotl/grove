import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema, listSchema } from "@lib/shared/contracts";
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
import { noteCandidates, queuePair } from "../../lib/memory/src/relationship-jobs.ts";
import type { GenerationProvider } from "@lib/ai";
import { relationshipCases } from "../fixtures/relationship-quality.ts";

const url = process.env.TEST_MIGRATION_DATABASE_URL!;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Disposable database required");
const authority = createDatabase(url);
const databaseName = `grove_relationships_${randomUUID().replaceAll("-", "")}_test`;
let admin: Knex, db: Knex, workerDb: Knex;
const accounts: string[] = [];
before(async () => {
  await authority.raw("CREATE DATABASE ??", [databaseName]);
  const target = (source: string) => {
    const value = new URL(source);
    value.pathname = `/${databaseName}`;
    return value.href;
  };
  admin = createDatabase(target(url));
  await admin.migrate.latest();
  db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  workerDb = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
});
after(async () => {
  for (const id of accounts) {
    await admin("accounts").where({ id }).update({ status: "deleting" });
  }
  await new MemoryService(
    workerDb,
    "relationship-tests-secret-32-characters",
  ).maintenance(async () => {});
  await Promise.all([db.destroy(), workerDb.destroy(), admin.destroy()]);
  await authority.raw("DROP DATABASE ?? WITH (FORCE)", [databaseName]);
  await authority.destroy();
});
const input = (content: string, rest = {}) =>
  rememberSchema.parse({ operationId: randomUUID(), content, ...rest });
async function fixture() {
  const subject = `relationships_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  accounts.push(principal.accountId);
  const generation: GenerationProvider = {
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
test("note and notebook connections have independent read, retry and discovery controls", async () => {
  const f = await fixture();
  const left = await f.service.project(f.principal, {
    name: "Trip",
    identity: randomUUID(),
  });
  const right = await f.service.project(f.principal, {
    name: "Budget",
    identity: randomUUID(),
  });
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip itinerary.", { projectId: left.id }),
  );
  const b = await f.service.remember(
    f.principal,
    input("October Kyoto trip hotel.", { projectId: left.id }),
  );
  const c = await f.service.remember(
    f.principal,
    input("October Kyoto trip budget.", { projectId: right.id }),
  );
  const notePair = await seed(f, [a.id, b.id]);
  const notebookPair = await seed(f, [a.id, c.id], "notebook");
  await f.service.settings(f.principal, {
    noteConnectionsEnabled: false,
    titlesTagsEnabled: false,
    classificationEnabled: false,
  });
  const list = (level: ConnectionLevel) =>
    f.service.relationships.list(
      f.principal,
      connectionQuerySchema.parse({ level }),
    );
  assert.equal((await list("note")).status, "disabled");
  assert.equal((await list("notebook")).items[0].id, notebookPair.id);
  assert.equal(
    (await f.service.relationships.retry(f.principal, "note", a.id)).status,
    "disabled",
  );
  await f.worker.scheduleOrganization(60);
  let jobs = await admin("jobs").where({ accountId: f.principal.accountId });
  assert(jobs.some((j) => j.kind === "notebook_profile"));
  assert(
    !jobs.some((j) =>
      ["relationship_scan", "note_relationship"].includes(j.kind),
    ),
  );
  await f.service.settings(f.principal, {
    noteConnectionsEnabled: true,
    notebookConnectionsEnabled: false,
  });
  assert.equal((await list("notebook")).status, "disabled");
  assert.equal((await list("note")).items[0].id, notePair.id);
  // Links remain visible when both title generation and classification are off.
  assert.equal(
    (await f.service.get(f.principal, a.id)).enrichment?.relationships[0].id,
    b.id,
  );
  await f.worker.scheduleOrganization(60);
  jobs = await admin("jobs").where({ accountId: f.principal.accountId });
  assert(jobs.some((j) => j.kind === "relationship_scan"));
  assert(
    !jobs.some((j) =>
      ["notebook_profile", "notebook_relationship"].includes(j.kind),
    ),
  );
  assert(
    await admin("notebook_relationships")
      .where({ id: notebookPair.id })
      .first(),
  );
});

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

function groundedGenerator(connected = false): GenerationProvider["generate"] {
  return async (schema, instructions, sources) => {
    const groups = instructions.match(
      /LEFT source IDs: (.+)\. RIGHT source IDs: (.+)\. Examining/,
    );
    assert(groups, "Assessments must identify both source groups");
    const leftIds = groups[1].split(", "),
      rightIds = groups[2].split(", ");
    const selected = [
      sources.find((s) => leftIds.includes(s.id))!,
      sources.find((s) => rightIds.includes(s.id))!,
    ];
    return schema.parse({
      relationship: connected ? "connected" : "complementary",
      reason:
        "Both cover the October Kyoto trip; lodging adds detail to the itinerary.",
      basis: connected ? "shared_goal" : "additional_context",
      direction: "both",
      support: [
        {
          kind: "specific_subject",
          subject: "October Kyoto trip",
          property: "lodging and itinerary",
          leftValue: "itinerary",
          rightValue: "lodging",
          conditions: "October trip",
          leftEvidence: [0],
          rightEvidence: [1],
        },
      ],
      evidence: selected.map((s) => ({
        id: s.id,
        version: s.version,
        quote: s.content.slice(0, 200),
      })),
    });
  };
}
async function drain(f: Awaited<ReturnType<typeof fixture>>, kinds: string[]) {
  for (let i = 0; i < 100; i++) {
    const jobs = await admin("jobs")
      .where({ accountId: f.principal.accountId })
      .whereIn("kind", kinds)
      .whereNull("failedAt")
      .orderBy("kind");
    if (!jobs.length) return;
    for (const job of jobs) {
      await admin("jobs")
        .where({ id: job.id })
        .update({ dueAt: admin.fn.now() });
      assert.equal(await f.worker.runJob(job.id), true);
      const remaining = await admin("jobs").where({ id: job.id }).first();
      assert(!remaining?.errorCode, `Worker failed: ${remaining?.errorCode}`);
    }
  }
  assert.fail("Relationship jobs did not converge");
}

test("asynchronous scans coalesce opposite pairs, retain dismissals, and never compare notes across notebooks", async () => {
  const f = await fixture();
  let calls = 0;
  f.worker.providers.generation!.generate = async (...args) => {
    calls++;
    return groundedGenerator()(...args);
  };
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip: book lodging."),
  );
  const b = await f.service.remember(
    f.principal,
    input("October Kyoto trip: book three nights."),
  );
  const project = await f.service.project(f.principal, {
    name: "Other",
    identity: randomUUID(),
  });
  await f.service.remember(
    f.principal,
    input(a.content, { projectId: project.id }),
  );
  await drain(f, ["relationship_scan", "note_relationship"]);
  assert.equal(calls, 1);
  const page = await f.service.relationships.list(
    f.principal,
    connectionQuerySchema.parse({ level: "note" }),
  );
  assert.equal(page.items.length, 1);
  const pair = page.items[0];
  assert.deepEqual([pair.from.id, pair.to.id].sort(), [a.id, b.id].sort());
  assert.equal(
    (await f.service.get(f.principal, b.id)).enrichment?.relationships[0]
      .connectionId,
    pair.id,
  );
  await f.service.relationships.review(f.principal, "note", pair.id, {
    operationId: randomUUID(),
    expectedRevision: pair.revision,
    expectedReviewVersion: pair.reviewVersion,
    dismissed: true,
  });
  await f.service.retryProcessing(f.principal, a.id, a.version);
  await drain(f, ["relationship_scan", "note_relationship"]);
  assert.equal(calls, 1, "Unchanged pairs use their checked state");
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note" }),
      )
    ).items.length,
    0,
  );
  await f.service.remember(
    f.principal,
    input("October Kyoto trip: book four nights.", {
      id: a.id,
      expectedVersion: a.version,
    }),
  );
  await drain(f, ["relationship_scan", "note_relationship"]);
  assert.equal(calls, 2);
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note" }),
      )
    ).items.length,
    1,
  );
});

test("template-only judgments are cached as abstentions and model inputs omit filing metadata", async () => {
  const f = await fixture();
  await f.service.remember(
    f.principal,
    input("Perfect Days review. Rating 4/5. Rewatch. Director: Wim Wenders."),
  );
  await f.service.remember(
    f.principal,
    input("Arrival review. Rating 4/5. Rewatch. Director: Denis Villeneuve."),
  );
  let calls = 0;
  f.worker.providers.generation!.generate = async (
    schema,
    _instructions,
    sources,
  ) => {
    calls++;
    assert(sources.every((s) => !("projectId" in s) && !("title" in s)));
    return schema.parse({
      relationship: "complementary",
      basis: "additional_context",
      direction: "both",
      reason: "Both film reviews have the same rating and Rewatch verdict.",
      evidence: sources.map((s) => ({
        id: s.id,
        version: s.version,
        quote: s.content,
      })),
      support: [
        {
          kind: "template",
          subject: "Film reviews",
          property: "rating and verdict",
          leftValue: "4/5 Rewatch",
          rightValue: "4/5 Rewatch",
          conditions: "review template",
          leftEvidence: [0],
          rightEvidence: [1],
        },
      ],
    });
  };
  await drain(f, ["relationship_scan", "note_relationship"]);
  assert.equal(calls, 1);
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note" }),
      )
    ).items.length,
    0,
  );
  await f.worker.scheduleOrganization(60);
  await drain(f, ["relationship_scan", "note_relationship"]);
  assert.equal(
    calls,
    1,
    "Checked abstentions do not repeatedly spend inference",
  );
});

test("text-only discovery retains short substantive terms", async () => {
  const f = await fixture();
  const a = await f.service.remember(f.principal, input("Gin, 30 ml."));
  const b = await f.service.remember(f.principal, input("Gin; 45 ml."));
  const candidates = await tenant(db, f.principal.accountId, async (trx) =>
    noteCandidates(trx, (await MemoryModel.query(trx).findById(a.id))!, {}),
  );
  assert(candidates.some((c) => c.id === b.id));
});

test("bounded text-only candidate recall covers labelled positive pairs amid template distractors", async (t) => {
  const positives = relationshipCases.filter((c) => c.level === "note" && !c.expected.includes("unrelated"));
  let found = 0;
  for (const sample of positives) {
    // Keep independent subjects in independent accounts, below ordinary API quotas.
    const f = await fixture();
    const notebook = await f.service.project(f.principal, { name: sample.name, identity: randomUUID() });
    const a = await f.service.remember(f.principal, input(sample.left[0], { projectId: notebook.id }));
    const b = await f.service.remember(f.principal, input(sample.right[0], { projectId: notebook.id }));
    for (let i = 0; i < 8; i++) await f.service.remember(f.principal,
      input(`Review journal recipe rating 4/5 Rewatch. Unconnected observation ${i}.`, { projectId: notebook.id }));
    const candidates = await tenant(db, f.principal.accountId, async (trx) =>
      noteCandidates(trx, (await MemoryModel.query(trx).findById(a.id))!, {}));
    assert(candidates.length <= 8);
    if (candidates.some((c) => c.id === b.id)) found++;
    // Completed recall-only accounts must not occupy later scheduler tests' window.
    await admin("accounts").where({ id: f.principal.accountId }).update({
      organizationDueAt: admin.raw("now() + interval '1 day'"),
    });
  }
  t.diagnostic(`Text-only labelled candidate recall: ${found}/${positives.length}; eight distractors per pair`);
  assert(found / positives.length >= 0.9);
});

test("policy cutover rechecks old pairs, preserves dismissals and fences stale reviews", async () => {
  const f = await fixture();
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip: book lodging."),
  );
  const b = await f.service.remember(
    f.principal,
    input("October Kyoto trip: reserve three nights."),
  );
  const [leftId, rightId] = [a.id, b.id].sort();
  const oldProfile = `relationships-v2-${relationHash([f.service.providers.generation!.profile, null])}`;
  assert.notEqual(currentRelationshipProfile(f.service.providers), oldProfile);
  const oldRevision = relationHash(["note", leftId, rightId, 1, 1, null]);
  const row = await seed(f, [a.id, b.id]);
  await admin("memory_relationships").where({ id: row.id }).update({
    profile: oldProfile,
    revision: oldRevision,
    dismissedRevision: oldRevision,
  });
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note", includeDismissed: true }),
      )
    ).items.length,
    0,
  );
  f.worker.providers.generation!.generate = groundedGenerator();
  await drain(f, ["relationship_scan", "note_relationship"]);
  const page = await f.service.relationships.list(
    f.principal,
    connectionQuerySchema.parse({ level: "note", includeDismissed: true }),
  );
  assert.equal(page.items.length, 1);
  const item = page.items[0];
  assert.equal(item.id, row.id);
  assert.notEqual(item.revision, oldRevision);
  assert.equal(item.dismissed, true);
  await assert.rejects(
    f.service.relationships.review(f.principal, "note", item.id, {
      operationId: randomUUID(),
      expectedRevision: oldRevision,
      expectedReviewVersion: 0,
      dismissed: false,
    }),
    { code: "relationship_changed" },
  );
});

test("policy reconciliation eventually reaches old pairs beyond a note's twenty-pair window", async () => {
  const f = await fixture();
  const a = await f.service.remember(f.principal, input("Anchor itinerary."));
  for (let i = 0; i < 24; i++) {
    const b = await f.service.remember(
      f.principal,
      input(`Unique${i} glyph${i}.`),
    );
    const pair = await seed(f, [a.id, b.id]);
    await admin("memory_relationships")
      .where({ id: pair.id })
      .update({ profile: "relationships-v2-old-policy" });
  }
  await admin("jobs")
    .where({ accountId: f.principal.accountId, kind: "relationship_scan" })
    .whereNot({ memoryId: a.id })
    .delete();
  f.worker.providers.generation!.generate = groundedGenerator();
  await drain(f, ["relationship_scan", "note_relationship"]);
  await f.worker.scheduleOrganization(60);
  await drain(f, ["relationship_scan", "note_relationship"]);
  const stale = await admin("memory_relationships")
    .where({ accountId: f.principal.accountId })
    .whereNot({ profile: currentRelationshipProfile(f.service.providers) });
  assert.equal(stale.length, 0);
});

test("old-policy backfill skips queued or exhausted pairs rather than starving later pairs", async () => {
  const f = await fixture();
  const a = await f.service.remember(f.principal, input("Anchor itinerary."));
  for (let i = 0; i < 24; i++) {
    const b = await f.service.remember(f.principal, input(`Unique${i} glyph${i}.`));
    const pair = await seed(f, [a.id, b.id]);
    await admin("memory_relationships").where({ id: pair.id }).update({ profile: "relationships-v2-old-policy" });
  }
  const first = await admin("memory_relationships").where({ accountId: f.principal.accountId }).orderBy("id").limit(20);
  for (const pair of first) await tenant(db, f.principal.accountId, (trx) =>
    queuePair(trx, f.principal.accountId, "note", pair.leftId, pair.rightId, currentRelationshipProfile(f.service.providers)!));
  await admin("jobs").where({ accountId: f.principal.accountId, kind: "note_relationship" }).update({ attempts: 5, failedAt: admin.fn.now() });
  await f.worker.scheduleOrganization(60);
  const pending = await admin("jobs").where({ accountId: f.principal.accountId, kind: "note_relationship" }).whereNull("failedAt");
  assert.equal(pending.length, 4);
});

test("late evidence cannot publish after a source edit, settings disable, or committed model switch", async () => {
  for (const change of ["edit", "settings", "profile"] as const) {
    const f = await fixture();
    const a = await f.service.remember(
      f.principal,
      input("October Kyoto trip: reserve lodging."),
    );
    await f.service.remember(
      f.principal,
      input("October Kyoto trip: lodging budget."),
    );
    await drain(f, ["relationship_scan"]);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const wait = new Promise<void>((r) => {
      release = r;
    });
    f.worker.providers.generation!.generate = async (...args) => {
      entered();
      await wait;
      return groundedGenerator()(...args);
    };
    const job = await admin("jobs")
      .where({ accountId: f.principal.accountId, kind: "note_relationship" })
      .first();
    await admin("jobs").where({ id: job.id }).update({ dueAt: admin.fn.now() });
    const pending = f.worker.runJob(job.id);
    await started;
    if (change === "edit")
      await f.service.remember(
        f.principal,
        input("October Kyoto trip is cancelled.", {
          id: a.id,
          expectedVersion: a.version,
        }),
      );
    if (change === "settings")
      await f.service.settings(f.principal, {
        captureEnabled: true,
        recallEnabled: true,
        noteConnectionsEnabled: false,
      });
    if (change === "profile")
      f.worker.jobProfiles = async () => ({
        embedding: null,
        decision: null,
        generation: "changed",
      });
    release();
    await pending;
    assert.equal(
      (
        await admin("memory_relationships").where({
          accountId: f.principal.accountId,
        })
      ).length,
      0,
    );
  }
});

test("notebook profiles resume bounded batches, use both notebooks, and disclose limited evidence", async () => {
  const f = await fixture();
  f.worker.providers.generation!.generate = groundedGenerator(true);
  await f.service.settings(f.principal, {
    captureEnabled: true,
    recallEnabled: true,
    summariesEnabled: false,
  });
  const left = await f.service.project(f.principal, {
    name: "Itinerary",
    identity: randomUUID(),
  });
  const right = await f.service.project(f.principal, {
    name: "Budget",
    identity: randomUUID(),
  });
  for (let i = 0; i < 65; i++)
    await f.service.remember(
      f.principal,
      input(`October Kyoto trip, itinerary entry ${i}.`, {
        projectId: left.id,
      }),
    );
  await f.service.remember(
    f.principal,
    input("October Kyoto trip: lodging budget.", { projectId: right.id }),
  );
  await f.worker.scheduleOrganization(60);
  const profile = await admin("jobs")
    .where({
      accountId: f.principal.accountId,
      kind: "notebook_profile",
      target: left.id,
    })
    .first();
  await admin("jobs")
    .where({ id: profile.id })
    .update({ dueAt: admin.fn.now() });
  assert.equal(await f.worker.runJob(profile.id), true);
  const partial = await admin("notebook_profiles")
    .where({ projectId: left.id })
    .first();
  assert.equal(partial.processed, 64);
  assert.equal(partial.complete, false);
  await drain(f, ["notebook_profile", "notebook_relationship"]);
  const page = await f.service.relationships.list(
    f.principal,
    connectionQuerySchema.parse({ level: "notebook" }),
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].breadth, "thread");
  const coverage =
    page.items[0].from.id === left.id
      ? page.items[0].coverage.from
      : page.items[0].coverage.to;
  assert.equal(coverage.total, 65);
  assert(coverage.examined <= 8);
  assert.equal(
    (await admin("notebook_profiles").where({ projectId: left.id }).first())
      .processed,
    65,
  );
  assert.equal(
    (
      await admin("jobs").where({
        accountId: f.principal.accountId,
        kind: "brief",
      })
    ).length,
    0,
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

test("invalid evidence exhausts bounded retries; explicit retry and daily-budget deferral preserve checked state", async () => {
  const f = await fixture();
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip: reserve lodging."),
  );
  await f.service.remember(
    f.principal,
    input("October Kyoto trip: reserve three nights."),
  );
  await drain(f, ["relationship_scan"]);
  const job = await admin("jobs")
    .where({ accountId: f.principal.accountId, kind: "note_relationship" })
    .first();
  f.worker.providers.generation!.generate = async (schema, _prompt, sources) =>
    schema.parse({
      relationship: "complementary",
      reason: "This must not publish.",
      support: [
        {
          kind: "specific_subject",
          subject: "Kyoto trip",
          property: "lodging",
          leftValue: "lodging",
          rightValue: "lodging",
          conditions: "recorded trip",
          leftEvidence: [0],
          rightEvidence: [1],
        },
      ],
      basis: "additional_context",
      direction: "both",
      evidence: sources.map((s) => ({
        id: s.id,
        version: s.version,
        quote: "Invented source text",
      })),
    });
  await admin("jobs")
    .where({ id: job.id })
    .update({ attempts: 4, dueAt: admin.fn.now() });
  await f.worker.runJob(job.id);
  const failed = await admin("jobs").where({ id: job.id }).first();
  assert(failed.failedAt);
  assert.equal(failed.errorCode, "relationship_invalid_evidence");
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note", endpointId: a.id }),
      )
    ).status,
    "failed",
  );
  await f.service.relationships.retry(f.principal, "note", a.id);
  await admin("jobs").where({ id: job.id }).update({ dueAt: admin.fn.now() });
  const noBudget = new MemoryService(
    workerDb,
    f.service.cursorSecret,
    undefined,
    f.worker.providers,
    0,
  );
  await noBudget.runJob(job.id);
  const deferred = await admin("jobs").where({ id: job.id }).first();
  assert.equal(deferred.attempts, 0);
  assert.equal(deferred.failedAt, null);
  assert.equal(deferred.errorCode, "inference_budget");
  f.worker.providers.generation!.generate = groundedGenerator();
  await drain(f, ["relationship_scan", "note_relationship"]);
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note" }),
      )
    ).items.length,
    1,
  );
});

test("relationship pagination binds its filters and exported review state survives reindexing", async () => {
  const f = await fixture();
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip itinerary."),
  );
  for (const detail of ["lodging", "travel", "budget"]) {
    const b = await f.service.remember(
      f.principal,
      input(`October Kyoto trip ${detail}.`),
    );
    await seed(f, [a.id, b.id]);
  }
  const query = connectionQuerySchema.parse({
    level: "note",
    endpointId: a.id,
    limit: 1,
  });
  const first = await f.service.relationships.list(f.principal, query);
  assert(first.nextCursor);
  const second = await f.service.relationships.list(f.principal, {
    ...query,
    cursor: first.nextCursor,
  });
  assert.notEqual(first.items[0].id, second.items[0].id);
  await assert.rejects(
    f.service.relationships.list(f.principal, {
      ...query,
      limit: 2,
      cursor: first.nextCursor,
    }),
    { code: "invalid_cursor" },
  );
  await assert.rejects(
    f.service.relationships.list(f.principal, {
      ...query,
      cursor: `${first.nextCursor}x`,
    }),
    { code: "invalid_cursor" },
  );
  const pair = first.items[0];
  await f.service.relationships.review(f.principal, "note", pair.id, {
    operationId: randomUUID(),
    expectedRevision: pair.revision,
    expectedReviewVersion: 0,
    dismissed: true,
  });
  await admin.raw("SELECT grove_reprocess(?, ?, ?)", [
    null,
    null,
    f.worker.providers.generation!.profile,
  ]);
  const exported = await f.service.relationships.exportPage(
    f.principal,
    "note",
  );
  assert.equal(
    exported.find((r) => r.id === pair.id)!.dismissedRevision,
    pair.revision,
  );
  assert.equal(exported.find((r) => r.id === pair.id)!.reviewVersion, 1);
});

test("deleting a moved cited note scrubs retained notebook excerpts and profiles", async () => {
  const f = await fixture();
  const p = await f.service.project(f.principal, {
    name: "Itinerary",
    identity: randomUUID(),
  });
  const q = await f.service.project(f.principal, {
    name: "Budget",
    identity: randomUUID(),
  });
  const destination = await f.service.project(f.principal, {
    name: "Moved notes",
    identity: randomUUID(),
  });
  const a = await f.service.remember(
    f.principal,
    input("A private Kyoto itinerary passage.", { projectId: p.id }),
  );
  const b = await f.service.remember(
    f.principal,
    input("A private Kyoto lodging budget.", { projectId: q.id }),
  );
  await seed(f, [a.id, b.id], "notebook");
  const moved = await f.service.remember(
    f.principal,
    input(a.content, {
      id: a.id,
      expectedVersion: a.version,
      projectId: destination.id,
    }),
  );
  await f.service.forget(f.principal, {
    operationId: randomUUID(),
    items: [{ id: a.id, expectedVersion: moved.version }],
  });
  const saved = await admin("notebook_relationships")
    .where({ accountId: f.principal.accountId })
    .first();
  assert.deepEqual(saved.assessment.evidence, []);
  assert(!JSON.stringify(saved).includes(a.content));
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

test("changed source snapshots can retry an exhausted pair without resetting unchanged failures", async () => {
  const f = await fixture();
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto trip: reserve lodging."),
  );
  await f.service.remember(
    f.principal,
    input("October Kyoto trip: lodging budget."),
  );
  await drain(f, ["relationship_scan"]);
  const job = await admin("jobs")
    .where({ accountId: f.principal.accountId, kind: "note_relationship" })
    .first();
  await admin("jobs")
    .where({ id: job.id })
    .update({ failedAt: admin.fn.now(), attempts: 5 });
  await f.service.retryProcessing(f.principal, a.id, a.version);
  await drain(f, ["relationship_scan"]);
  assert.equal((await admin("jobs").where({ id: job.id }).first()).attempts, 5);
  await f.service.remember(
    f.principal,
    input("October Kyoto trip: reserve four nights of lodging.", {
      id: a.id,
      expectedVersion: a.version,
    }),
  );
  await drain(f, ["relationship_scan"]);
  const revised = await admin("jobs").where({ id: job.id }).first();
  assert.equal(revised.failedAt, null);
  assert.equal(revised.attempts, 0);
  f.worker.providers.generation!.generate = groundedGenerator();
  await drain(f, ["note_relationship"]);
  assert.equal(
    (
      await f.service.relationships.list(
        f.principal,
        connectionQuerySchema.parse({ level: "note" }),
      )
    ).items.length,
    1,
  );
});

test("notebook candidate discovery resumes beyond the first hundred collections", async () => {
  const f = await fixture();
  const origin = await f.service.project(f.principal, {
    name: "Itinerary",
    identity: randomUUID(),
  });
  await f.service.remember(
    f.principal,
    input("October Kyoto trip itinerary.", { projectId: origin.id }),
  );
  const ids = Array.from({ length: 105 }, () => randomUUID()).sort();
  const target = ids.at(-1)!;
  await tenant(db, f.principal.accountId, async (trx) => {
    await trx("projects").insert(
      ids.map((id) => ({
        id,
        accountId: f.principal.accountId,
        name: "Candidate",
        identity: id,
      })),
    );
    await trx("notebook_profiles").insert(
      ids.map((id) => ({
        accountId: f.principal.accountId,
        projectId: id,
        contentVersion: 0,
        profile: currentRelationshipProfile(f.service.providers),
        total: 1,
        processed: 1,
        complete: true,
        data: JSON.stringify({
          discoveryComplete: true,
          sum: [],
          vectors: 0,
          hashes: [],
          representatives: [],
          terms:
            id === target
              ? { october: 1, kyoto: 1, itinerary: 1 }
              : { printer: 1, toner: 1 },
        }),
      })),
    );
  });
  await f.worker.scheduleOrganization(60);
  const job = await admin("jobs")
    .where({
      accountId: f.principal.accountId,
      kind: "notebook_profile",
      target: origin.id,
    })
    .first();
  await admin("jobs").where({ id: job.id }).update({ dueAt: admin.fn.now() });
  await f.worker.runJob(job.id);
  const partial = await admin("notebook_profiles")
    .where({ projectId: origin.id })
    .first();
  assert.equal(partial.data.candidateAfter, ids[19]);
  assert(await admin("jobs").where({ id: job.id }).first());
  await f.service.settings(f.principal, {
    captureEnabled: true,
    recallEnabled: true,
    notebookConnectionsEnabled: false,
  });
  await f.service.settings(f.principal, {
    captureEnabled: true,
    recallEnabled: true,
    notebookConnectionsEnabled: true,
  });
  await f.worker.scheduleOrganization(60);
  await drain(f, ["notebook_profile"]);
  const pair = await admin("jobs")
    .where({ accountId: f.principal.accountId, kind: "notebook_relationship" })
    .first();
  assert(pair);
  assert.deepEqual(
    [pair.scope.leftId, pair.scope.rightId].sort(),
    [origin.id, target].sort(),
  );
});

test("library relationship projection batches canonical reads instead of adding queries per note", async () => {
  const f = await fixture();
  const a = await f.service.remember(
    f.principal,
    input("October Kyoto itinerary."),
  );
  for (const detail of ["hotel", "budget", "transport", "food"]) {
    const b = await f.service.remember(
      f.principal,
      input(`October Kyoto ${detail}.`),
    );
    await seed(f, [a.id, b.id]);
  }
  const queries: string[] = [];
  const observe = ({ sql }: { sql: string }) => {
    if (sql.includes("memory_relationships")) queries.push(sql);
  };
  db.on("query", observe);
  try {
    const page = await f.service.list(f.principal, listSchema.parse({}));
    assert.equal(page.items.length, 5);
    assert.equal(
      page.items.find((n) => n.id === a.id)!.enrichment!.relationships.length,
      4,
    );
    assert.equal(queries.length, 1);
  } finally {
    db.off("query", observe);
  }
});
