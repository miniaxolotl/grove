import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  listSchema,
  rememberSchema,
  type Memory,
  type MemoryList,
} from "@lib/shared/contracts";
import { noteTitle } from "@lib/shared/search";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "note-ordering-test-secret");
after(() => db.destroy());

async function fixture() {
  const subject = `order_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const owner = sessionPrincipal(rows[0].id, subject);
  const notes: Memory[] = [];
  for (const title of [
    "Zulu",
    "apple",
    "Apple",
    "Éclair",
    "日本語",
    "alpha",
    "Beta",
  ])
    notes.push(
      await service.remember(
        owner,
        rememberSchema.parse({
          operationId: randomUUID(),
          content: `# ${title}\nGarden evidence.`,
          kind: "fact",
          source: { agent: "website" },
        }),
      ),
    );
  await tenant(db, owner.accountId, async (trx) => {
    for (const [index, note] of notes.entries()) {
      const createdAt = `2020-01-0${Math.floor(index / 2) + 1}T00:00:00.000Z`;
      const updatedAt = `2020-02-0${Math.floor((notes.length - index) / 2) + 1}T00:00:00.000Z`;
      await trx("memories")
        .where({ id: note.id })
        .update({ createdAt, updatedAt });
      note.createdAt = createdAt;
      note.updatedAt = updatedAt;
    }
  });
  return { owner, notes };
}

for (const sort of [
  "created_asc",
  "created_desc",
  "updated_asc",
  "updated_desc",
  "title_asc",
  "title_desc",
] as const) {
  test(`${sort} orders the complete matching library with deterministic cursor ties`, async () => {
    const { owner, notes } = await fixture();
    const ascending = sort.endsWith("asc");
    const titleKey = (note: Memory) =>
      noteTitle(note.content).replace(/[A-Z]/g, (letter) =>
        letter.toLowerCase(),
      );
    const expected = [...notes]
      .sort((left, right) => {
        const a = sort.startsWith("title")
          ? titleKey(left)
          : sort.startsWith("created")
            ? left.createdAt
            : left.updatedAt;
        const b = sort.startsWith("title")
          ? titleKey(right)
          : sort.startsWith("created")
            ? right.createdAt
            : right.updatedAt;
        const comparison =
          Buffer.compare(Buffer.from(a), Buffer.from(b)) ||
          left.id.localeCompare(right.id);
        return ascending ? comparison : -comparison;
      })
      .map((note) => note.id);
    for (const query of [undefined, "garden"]) {
      const input = listSchema.parse({
        query,
        sort,
        limit: 2,
        searchMode: "lexical",
      });
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.list(owner, { ...input, cursor });
        seen.push(...page.items.map((note) => note.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.deepEqual(seen, expected);
    }
  });
}

test("title ordering rejects stale titles and direction-swapped cursors", async () => {
  const { owner, notes } = await fixture();
  const input = listSchema.parse({ sort: "title_asc", limit: 2 });
  const first = await service.list(owner, input);
  assert(first.nextCursor);
  await assert.rejects(
    service.list(owner, {
      ...input,
      sort: "title_desc" as MemoryList["sort"],
      cursor: first.nextCursor,
    }),
    { code: "invalid_cursor" },
  );
  await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: notes[0].id,
      expectedVersion: 1,
      content: "# A changed title\nGarden evidence.",
      kind: "fact",
      source: { agent: "website" },
    }),
  );
  await assert.rejects(
    service.list(owner, { ...input, cursor: first.nextCursor }),
    { code: "stale_search" },
  );
});

test("title-order cursors reject worker title changes and cannot cross accounts", async () => {
  const { owner, notes } = await fixture();
  const other = await fixture();
  const saved = await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: notes[0].id,
      expectedVersion: notes[0].version,
      content: "Unheaded garden evidence.",
      kind: "fact",
      source: { agent: "website" },
    }),
  );
  const titled = new MemoryService(db, service.cursorSecret, undefined, {
    generation: {
      profile: "ordering-title",
      async generate() {
        throw new Error("No provider calls in ordering");
      },
    },
  });
  await tenant(db, owner.accountId, (trx) =>
    trx("memory_enrichments").insert({
      accountId: owner.accountId,
      memoryId: saved.id,
      version: saved.version,
      profile: "ordering-title",
      kind: "organization",
      data: { title: "A generated garden title" },
    }),
  );
  const input = listSchema.parse({ sort: "title_asc", limit: 2 });
  const first = await titled.list(owner, input);
  assert(first.nextCursor);
  assert.equal(first.items[0].id, saved.id);
  await assert.rejects(
    titled.list(other.owner, { ...input, cursor: first.nextCursor }),
    { code: "invalid_cursor" },
  );
  assert(
    !first.items.some((note) =>
      other.notes.some((foreign) => foreign.id === note.id),
    ),
  );
  await tenant(db, owner.accountId, (trx) =>
    trx("memory_enrichments")
      .where({ memoryId: saved.id, profile: "ordering-title" })
      .update({ data: { title: "Zulu generated garden title" } }),
  );
  await assert.rejects(
    titled.list(owner, { ...input, cursor: first.nextCursor }),
    { code: "stale_search" },
  );
});
