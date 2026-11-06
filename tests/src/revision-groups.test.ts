import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  rememberSchema,
  type Memory,
  type Principal,
} from "@lib/shared/contracts";
import { sourceEditsBetween } from "@lib/shared/document-edits";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "revision-groups-test-secret");
let owner: Principal;
beforeEach(async () => {
  const subject = `revision_group_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  owner = sessionPrincipal(rows[0].id, subject);
});
after(() => db.destroy());
const create = () =>
  service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content:
        "Keep the garden notes concise and preserve all the original details.",
    }),
  );
const edit = (
  note: Memory,
  content: string,
  editSession: string,
  extra = {},
  principal = owner,
) =>
  service.updateMemory(principal, {
    id: note.id,
    expectedVersion: note.version,
    operationId: randomUUID(),
    capture: "explicit",
    edits: sourceEditsBetween(note.content, content),
    editSession,
    ...extra,
  });

test("nearby small edits form one logical revision while exact save versions remain immutable", async () => {
  let note = await create();
  const session = randomUUID(),
    original = note.content;
  const first = await edit(
    note,
    note.content.replace("concise", "short"),
    session,
  );
  note = await edit(first, first.content.replace("garden", "plant"), session);
  note = await edit(note, note.content.replace("details", "facts"), session);
  const history = await service.revisions(owner, note.id);
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((r) => [r.revision, r.firstVersion, r.version, r.saves]),
    [
      [2, 2, 4, 3],
      [1, 1, 1, 1],
    ],
  );
  assert.equal(history[0].content, note.content);
  assert.equal(history[1].content, original);
  assert.equal(
    (await service.sourceRevision(owner, note.id, 2)).content,
    first.content,
  );
  assert.equal(
    (await service.getMemoryDocument(owner, note.id, 2)).revision,
    2,
  );
  assert.equal(
    (
      await tenant(db, owner.accountId, (trx) =>
        trx("memory_revisions").where({ memoryId: note.id }),
      )
    ).length,
    4,
  );
  await assert.rejects(
    () => edit(first, "Do not overwrite the winner", session),
    { code: "version_conflict" },
  );
});

test("time gaps and different editing sessions begin separate revisions", async () => {
  let note = await create();
  const session = randomUUID();
  note = await edit(note, `${note.content}!`, session);
  await tenant(db, owner.accountId, (trx) =>
    trx("memory_revisions")
      .where({ memoryId: note.id, version: note.version })
      .update({ createdAt: trx.raw("now() - interval '31 seconds'") }),
  );
  note = await edit(note, `${note.content}!`, session);
  note = await edit(note, `${note.content}!`, randomUUID());
  assert.equal((await service.revisions(owner, note.id)).length, 4);
});

test("checkpoints, substantial or structural edits and metadata writes are revision boundaries", async () => {
  let note = await create();
  const session = randomUUID();
  note = await edit(note, `${note.content}!`, session);
  note = await edit(note, `${note.content}!`, session, { checkpoint: true });
  note = await edit(note, `${note.content}!`, session);
  note = await edit(note, `${note.content}\n\n## Another section`, session);
  note = await edit(
    note,
    "A substantial complete rewrite. ".repeat(15),
    session,
  );
  note = await service.updateMemory(owner, {
    id: note.id,
    expectedVersion: note.version,
    operationId: randomUUID(),
    capture: "explicit",
    kind: "decision",
  });
  note = await edit(note, `${note.content}!`, session);
  const history = await service.revisions(owner, note.id);
  assert.equal(history.length, 8);
  assert.deepEqual(
    history.map((r) => r.revision),
    [8, 7, 6, 5, 4, 3, 2, 1],
  );
});

test("another trusted writer cannot join a group by copying its session hint", async () => {
  let note = await create();
  const session = randomUUID();
  note = await edit(note, `${note.content}!`, session);
  const grant = await service.grant(
    owner,
    {
      name: "Different writer",
      capabilities: ["memory:read", "memory:write"],
      personal: true,
      allProjects: false,
      projectIds: [],
    },
    { key: true },
  );
  const agent = {
    ...owner,
    type: "key" as const,
    connectionId: grant.connection.id,
  };
  note = await edit(note, `${note.content}!`, session, {}, agent);
  note = await edit(note, `${note.content}!`, session);
  assert.equal((await service.revisions(owner, note.id)).length, 4);
});

test("history groups before applying its limit and retry receipts do not add saves", async () => {
  let note = await create();
  const session = randomUUID();
  for (let n = 0; n < 105; n++)
    note = await edit(note, `${note.content}!`, session);
  const input = {
    id: note.id,
    expectedVersion: note.version,
    operationId: randomUUID(),
    capture: "explicit" as const,
    edits: sourceEditsBetween(note.content, `${note.content}?`),
    editSession: session,
  };
  const saved = await service.updateMemory(owner, input);
  assert.equal(
    (await service.updateMemory(owner, input)).version,
    saved.version,
  );
  const history = await service.revisions(owner, note.id);
  assert.equal(
    history.length,
    2,
    "the initial revision is not hidden by 100 coalesced saves",
  );
  assert.equal(history[0].saves, 106);
  assert.equal(history[1].version, 1);
});

test("a long-running burst is bounded even without an idle gap", async () => {
  let note = await create();
  const session = randomUUID();
  note = await edit(note, `${note.content}!`, session);
  await tenant(db, owner.accountId, (trx) =>
    trx("memory_revisions")
      .where({ memoryId: note.id, version: note.version })
      .update({
        revisionGroup: trx.raw(
          "jsonb_set(revision_group, '{startedAt}', to_jsonb((now() - interval '121 seconds')::text))",
        ),
      }),
  );
  note = await edit(note, `${note.content}!`, session);
  assert.equal((await service.revisions(owner, note.id)).length, 3);
});

test("cumulative edit complexity eventually starts a new revision", async () => {
  let note = await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      content: "A retained paragraph. ".repeat(40),
    }),
  );
  const session = randomUUID();
  for (let n = 0; n < 51; n++)
    note = await edit(note, `${note.content}${"!".repeat(20)}`, session);
  const history = await service.revisions(owner, note.id);
  assert.equal(history.length, 3);
  assert.equal(history[0].saves, 1);
  assert.equal(history[1].saves, 50);
});

test("restore stays a separate revision and does not reopen the earlier editing burst", async () => {
  let note = await create();
  const session = randomUUID();
  note = await edit(note, `${note.content}!`, session);
  note = await edit(note, `${note.content}!`, session);
  const restored = await service.lifecycle(owner, note.id, "restore", {
    operationId: randomUUID(),
    expectedVersion: note.version,
    revision: 1,
  });
  note = await edit(restored, `${restored.content}!`, session);
  const history = await service.revisions(owner, note.id);
  assert.deepEqual(
    history.map((r) => [r.revision, r.saves]),
    [
      [4, 1],
      [3, 1],
      [2, 2],
      [1, 1],
    ],
  );
});
