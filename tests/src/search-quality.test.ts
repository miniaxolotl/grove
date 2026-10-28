import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase, tenant, MemoryModel } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import {
  listSchema,
  recallSchema,
  rememberSchema,
} from "@lib/shared/contracts";
import { noteTitle, searchExpansion } from "@lib/shared/search";
import { createApp } from "../../packages/api/src/app.ts";
import { searchEvidence } from "../../lib/memory/src/search-evidence.ts";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "search-quality-test-secret");
after(() => db.destroy());
async function account() {
  const subject = `search_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  return sessionPrincipal(rows[0].id, subject);
}
async function fixture(contents: string[]) {
  const owner = await account();
  const notes = [];
  for (const content of contents)
    notes.push(
      await service.remember(
        owner,
        rememberSchema.parse({ operationId: randomUUID(), content }),
      ),
    );
  return { owner, notes };
}

test("title matches outrank repeated body matches in final recall", async () => {
  const { owner, notes } = await fixture([
    "# Other\n" + "garden ".repeat(30),
    "# Garden\nPlanting advice",
  ]);
  const result = await service.recall(
    owner,
    recallSchema.parse({ query: "garden" }),
  );
  assert.equal(result.items[0]?.id, notes[1].id);
});

test("prefix and typo search cover every positive term in recall and list", async () => {
  const { owner, notes } = await fixture([
    "# Garden design\nChoosing plants",
    "# Software\nDesign patterns",
  ]);
  for (const query of ["garden des", "gardn design"])
    for (const result of [
      await service.recall(owner, recallSchema.parse({ query })),
      await service.list(
        owner,
        listSchema.parse({ query, searchMode: "lexical" }),
      ),
    ]) {
      assert.deepEqual(
        result.items.map((note) => note.id),
        [notes[0].id],
        query,
      );
    }
});

test("strict operators and phrases do not gain false title matches", async () => {
  const { owner, notes } = await fixture([
    "# alpha\nbeta",
    "# Garden\nCooking advice",
    "# Garden\nGrowing flowers",
  ]);
  for (const query of ['"alpha alpha"', "garden -cooking", "garden OR alpha"])
    assert.deepEqual(
      new Set(
        (
          await service.list(
            owner,
            listSchema.parse({ query, searchMode: "lexical" }),
          )
        ).items.map((note) => note.id),
      ),
      new Set(
        query.startsWith('"')
          ? []
          : query.includes("-")
            ? [notes[2].id]
            : notes.map((note) => note.id),
      ),
    );
});

test("relevance pagination is title-first and rejects changed search snapshots", async () => {
  const { owner, notes } = await fixture([
    "# Other\nGarden",
    "# Garden\nOne",
    "# Garden\nTwo",
  ]);
  const input = listSchema.parse({
    query: "garden",
    sort: "relevance",
    searchMode: "lexical",
    limit: 1,
  });
  const first = await service.list(owner, input);
  assert.notEqual(first.items[0].id, notes[0].id);
  assert(first.nextCursor);
  const second = await service.list(owner, {
    ...input,
    cursor: first.nextCursor,
  });
  assert.notEqual(second.items[0].id, first.items[0].id);
  await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: notes[0].id,
      expectedVersion: 1,
      content: "# Garden\nA new title",
    }),
  );
  await assert.rejects(
    service.list(owner, { ...input, cursor: first.nextCursor }),
    { code: "stale_search" },
  );
});

test("current visible enrichment titles retrieve notes, disabled and stale titles do not", async () => {
  const { owner, notes } = await fixture([
    "Some ordinary opening\nA quiet text",
  ]);
  const titled = new MemoryService(
    db,
    "search-quality-test-secret",
    undefined,
    {
      generation: {
        profile: "search-title-v1",
        async generate() {
          throw new Error("No inference expected");
        },
      },
    },
  );
  await tenant(db, owner.accountId, (trx) =>
    trx("memory_enrichments").insert({
      accountId: owner.accountId,
      memoryId: notes[0].id,
      version: 1,
      kind: "organization",
      profile: "search-title-v1",
      data: { title: "Orchid calendar", tags: [] },
    }),
  );
  const search = () =>
    titled.list(
      owner,
      listSchema.parse({ query: "orchid", searchMode: "lexical" }),
    );
  assert.deepEqual(
    (await search()).items.map((note) => note.id),
    [notes[0].id],
  );
  await tenant(db, owner.accountId, (trx) =>
    trx("accounts")
      .where({ id: owner.accountId })
      .update({ titlesTagsEnabled: false }),
  );
  assert.equal((await search()).items.length, 0);
  await tenant(db, owner.accountId, (trx) =>
    trx("accounts")
      .where({ id: owner.accountId })
      .update({ titlesTagsEnabled: true }),
  );
  titled.providers.generation = {
    profile: "search-title-v2",
    async generate() {
      throw new Error("No provider");
    },
  };
  assert.equal((await search()).items.length, 0);
  titled.providers.generation = {
    profile: "search-title-v1",
    async generate() {
      throw new Error("No provider");
    },
  };
  await service.remember(
    owner,
    rememberSchema.parse({
      operationId: randomUUID(),
      id: notes[0].id,
      expectedVersion: 1,
      content: "A revised ordinary opening\nA quiet text",
    }),
  );
  assert.equal((await search()).items.length, 0);
});

test("search match evidence is query/version-bound and escaped plain text", async () => {
  const { owner, notes } = await fixture([
    "# Running\n" +
      "Background words. ".repeat(20) +
      "The running guide <script>alert(1)</script>",
  ]);
  const result = await service.list(
    owner,
    listSchema.parse({ query: "runs", searchMode: "lexical" }),
  );
  const detail = result.matches?.[notes[0].id];
  assert(detail);
  assert.equal(detail.version, notes[0].version);
  assert.equal(detail.query, "runs");
  assert(detail.title.ranges.length > 0);
  assert(detail.snippet.text.toLowerCase().includes("running"));
  assert.equal(
    (
      (await service.get(owner, notes[0].id)) as unknown as {
        matches?: unknown;
      }
    ).matches,
    undefined,
  );
});

test("typo lanes and metadata remain tenant and notebook scoped", async () => {
  const { owner, notes } = await fixture(["# Garden design\nPrivate note"]);
  const foreign = await account();
  assert.equal(
    (
      await service.list(
        foreign,
        listSchema.parse({ query: "gardn", searchMode: "lexical" }),
      )
    ).items.length,
    0,
  );
  const notebook = await service.project(owner, {
    name: "Empty notebook",
    identity: randomUUID(),
  });
  assert.equal(
    (
      await service.list(
        owner,
        listSchema.parse({
          query: "gardn",
          projectId: notebook.id,
          searchMode: "lexical",
        }),
      )
    ).items.length,
    0,
  );
  assert(notes.length);
});

test("key-scoped relevance cursors ignore last-used bookkeeping", async () => {
  const { owner } = await fixture(["# Garden\nOne", "# Garden\nTwo"]);
  const grant = await service.grant(
    owner,
    {
      name: "Search",
      capabilities: ["memory:read"],
      personal: true,
      allProjects: false,
      projectIds: [],
    },
    { key: true },
  );
  const principal = {
    ...owner,
    type: "key" as const,
    connectionId: grant.connection.id,
  };
  const input = listSchema.parse({
    query: "garden",
    limit: 1,
    searchMode: "lexical",
  });
  const first = await service.list(principal, input);
  assert(first.nextCursor);
  const second = await service.list(principal, {
    ...input,
    cursor: first.nextCursor,
  });
  assert.notEqual(first.items[0].id, second.items[0].id);
});

test("fuzzy-only ranking uses the weakest term similarity rather than an ID tie", async () => {
  const { owner, notes } = await fixture([
    "Placeholder one",
    "Placeholder two",
  ]);
  const [weak, strong] = notes.sort((a, b) => a.id.localeCompare(b.id));
  for (const [note, content] of [
    [weak, "# Database garden"],
    [strong, "# Databset garden"],
  ] as const)
    await service.remember(
      owner,
      rememberSchema.parse({
        id: note.id,
        expectedVersion: 1,
        operationId: randomUUID(),
        content,
      }),
    );
  const result = await service.list(
    owner,
    listSchema.parse({ query: "databse garden", searchMode: "lexical" }),
  );
  assert.equal(result.items[0].id, strong.id);
});

test("recall accounts for search evidence in its character budget", async () => {
  const { owner } = await fixture([
    "# Garden\nA planting guide",
    "# Garden\nA second guide",
  ]);
  for (const limit of [700, 800, 900, 1000, 1100, 1200]) {
    const result = await service.recall(
      owner,
      recallSchema.parse({ query: "garden", maxCharacters: limit }),
    );
    const cost = result.items.reduce(
      (n, note) =>
        n +
        JSON.stringify(note).length +
        JSON.stringify(result.matches?.[note.id] ?? {}).length,
      0,
    );
    assert(
      cost <= limit,
      `Returned ${cost} source/evidence characters for ${limit}`,
    );
  }
});

test("title evidence preserves the full displayed title even when its match is late", async () => {
  const { owner, notes } = await fixture([`# ${"a ".repeat(48)}Garden\nBody`]);
  const result = await service.list(
    owner,
    listSchema.parse({ query: "garden", searchMode: "lexical" }),
  );
  const detail = result.matches![notes[0].id];
  assert.equal(detail.title.text, noteTitle(notes[0].content));
  assert(detail.title.ranges.length);
});

test("shared title resolution and SQL agree on whitespace, truncation and Unicode", async () => {
  for (const content of [
    "\u00a0\n# Garden\r\nBody",
    "# " + "a".repeat(109) + "🌱x",
    "\nPlain text\nBody",
    "##\tHeading\r\nBody",
    "# " + "🌱".repeat(60),
  ]) {
    const result = await tenant(db, (await account()).accountId, (trx) =>
      trx.raw("SELECT grove_search_title(?::text,?::text) AS title", [
        content,
        "Visible title",
      ]),
    );
    assert.equal(result.rows[0].title, noteTitle(content, "Visible title"));
  }
  for (const query of [
    "garden OR cooking",
    "garden -cooking",
    '"garden design"',
    "garden ".repeat(17),
    "a".repeat(65),
  ])
    assert.equal(searchExpansion(query), undefined);
});

test("semantic neighbors and salience cannot suppress typos or overtake title tiers", async () => {
  const { owner, notes } = await fixture([
    "# Garden\nSoil",
    "# Other\nGarden",
    "# Unrelated\nContext",
  ]);
  const admin = createDatabase(process.env.TEST_MIGRATION_DATABASE_URL!);
  const profile = `search-vector-${randomUUID()}`;
  const vector = [1, ...Array<number>(383).fill(0)];
  const hybrid = new MemoryService(
    db,
    service.cursorSecret,
    { profile, model: "synthetic", dimensions: 384, embed: async () => vector },
    {
      decision: {
        profile: "search-salience",
        async classify() {
          throw new Error("No paid provider");
        },
      },
    },
  );
  try {
    await admin("embedding_profiles").insert({
      id: profile,
      model: "synthetic",
      dimensions: 384,
    });
    await tenant(db, owner.accountId, async (trx) => {
      for (const note of notes.slice(1))
        await trx("memory_embeddings").insert({
          accountId: owner.accountId,
          memoryId: note.id,
          version: 1,
          profile,
          embedding: JSON.stringify(vector),
        });
      await trx("memory_enrichments").insert({
        accountId: owner.accountId,
        memoryId: notes[1].id,
        version: 1,
        profile: "search-salience",
        kind: "decision",
        data: { salience: 1 },
      });
    });
    for (const query of ["garden", "gardn"]) {
      const result = await hybrid.recall(owner, recallSchema.parse({ query }));
      assert.equal(result.items[0]?.id, notes[0].id);
      assert(result.items.some((note) => note.id === notes[2].id));
      assert.equal(result.matches![notes[2].id].kind, "semantic");
      assert.deepEqual(result.matches![notes[2].id].snippet.ranges, []);
    }
  } finally {
    await admin.destroy();
  }
});

test("relevance cursors observe asynchronous title changes and date sorts stay global", async () => {
  const { owner, notes } = await fixture([
    "# Garden\nOne",
    "An opening\nGarden",
    "# Other again\nGarden",
  ]);
  await tenant(db, owner.accountId, (trx) =>
    trx("memories")
      .where({ id: notes[0].id })
      .update({ updatedAt: "2020-01-01T00:00:00Z" }),
  );
  const input = listSchema.parse({
    query: "garden",
    sort: "updated_desc",
    limit: 1,
    searchMode: "lexical",
  });
  const first = await service.list(owner, input);
  assert.notEqual(first.items[0].id, notes[0].id);
  const seen = [first.items[0].id];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await service.list(owner, { ...input, cursor });
    seen.push(...page.items.map((note) => note.id));
    cursor = page.nextCursor;
  }
  assert.equal(new Set(seen).size, 3);
  assert.equal(seen.at(-1), notes[0].id);
  const titled = new MemoryService(db, service.cursorSecret, undefined, {
    generation: {
      profile: "live-title",
      async generate() {
        throw new Error("No provider");
      },
    },
  });
  const relevance = listSchema.parse({
    query: "garden",
    limit: 1,
    searchMode: "lexical",
  });
  const page = await titled.list(owner, relevance);
  await tenant(db, owner.accountId, (trx) =>
    trx("memory_enrichments").insert({
      accountId: owner.accountId,
      memoryId: notes[1].id,
      version: 1,
      profile: "live-title",
      kind: "organization",
      data: { title: "Garden" },
    }),
  );
  await assert.rejects(
    titled.list(owner, { ...relevance, cursor: page.nextCursor! }),
    { code: "stale_search" },
  );
});

test("fuzzy expansion uses a global lexical shortfall, not a per-page or semantic trigger", async () => {
  const { owner, notes } = await fixture([
    ...Array.from(
      { length: 40 },
      (_, i) => `# Databse garden\nExact note ${i}`,
    ),
    "# Database garden\nTypo-only match",
  ]);
  const result = await service.list(
    owner,
    listSchema.parse({
      query: "databse garden",
      searchMode: "lexical",
      limit: 100,
    }),
  );
  assert.equal(result.items.length, 40);
  assert(!result.items.some((note) => note.id === notes[40].id));
  const input = listSchema.parse({
    query: "databse garden",
    searchMode: "lexical",
    sort: "updated_asc",
    limit: 39,
  });
  const first = await service.list(owner, input);
  const last = await service.list(owner, {
    ...input,
    cursor: first.nextCursor!,
  });
  assert.equal(last.items.length, 1);
  assert(!last.items.some((note) => note.id === notes[40].id));
});

test("REST list, recall and Ask source search propagate query-bound evidence", async () => {
  const { owner, notes } = await fixture([
    "# Garden design\nKeep native planting choices together.",
  ]);
  const app = createApp({
    memories: service,
    auth: { principal: async () => owner },
    origin: "http://localhost",
    siteUrl: "http://localhost:3000",
    issuer: "https://clerk.example.test",
    webhookSecret: "whsec_dGVzdA==",
    ready: async () => {},
  });
  for (const path of ["/v1/memories/search", "/v1/recall", "/v1/ask"]) {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "garden des",
        ...(path.endsWith("/ask") ? { mode: "search" } : {}),
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    const items = result.data.items ?? result.data.sources;
    assert.equal(items[0].id, notes[0].id);
    assert.equal(result.data.matches[notes[0].id].query, "garden des");
    assert.equal(result.data.matches[notes[0].id].version, 1);
  }
});

test("search evidence rejects a title changed between candidate selection and presentation", async () => {
  const { owner, notes } = await fixture(["An ordinary opening\nBody text"]);
  const note = notes[0];
  const selected = Object.assign(new MemoryModel(), {
    id: note.id,
    version: note.version,
    searchTier: 0,
    searchTitle: "Old title",
    searchScore: 1,
  });
  const presented = {
    ...note,
    enrichment: { ...note.enrichment!, title: "New title" },
  };
  await assert.rejects(
    tenant(db, owner.accountId, (trx) =>
      searchEvidence(trx, [presented], "old", [selected]),
    ),
    { code: "stale_search" },
  );
});
