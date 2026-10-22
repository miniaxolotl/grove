import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { listSchema } from "@lib/shared/contracts";
import { capacityFixture } from "./fixtures/capacity.ts";

let fixture: Awaited<ReturnType<typeof capacityFixture>>;
before(async () => {
  fixture = await capacityFixture({ accounts: 2, notes: 100 });
});
after(async () => {
  await fixture?.close();
});

test("presentation query budget is independent of page size, with tenant and revision fences", async () => {
  const principal = fixture.principals[0];
  const list = async (limit: number) => {
    let queries = 0;
    const onQuery = () => queries++;
    fixture.db.on("query", onQuery);
    try {
      return {
        page: await fixture.service.list(
          principal,
          listSchema.parse({ limit }),
        ),
        queries,
      };
    } finally {
      fixture.db.off("query", onQuery);
    }
  };
  const small = await list(1),
    large = await list(100);
  assert.equal(small.queries, large.queries);
  assert.ok(large.queries <= 25, `Page used ${large.queries} SQL queries`);
  assert.equal(large.page.items.length, 100);
  assert.ok(
    large.page.items.every(
      (item) =>
        item.indexing === "ready" && item.enrichment?.status === "ready",
    ),
  );
  const foreign = await fixture.service.list(
    fixture.principals[1],
    listSchema.parse({ limit: 100 }),
  );
  assert.ok(
    foreign.items.every(
      (item) => !large.page.items.some((own) => own.id === item.id),
    ),
  );

  const [stale, failed, archived, expired] = large.page.items;
  await fixture
    .admin("memories")
    .where({ id: stale.id })
    .update({ version: 2 });
  await fixture
    .admin("memory_embeddings")
    .where({ memoryId: failed.id })
    .delete();
  await fixture.admin("jobs").insert({
    accountId: principal.accountId,
    memoryId: failed.id,
    version: 1,
    kind: "embedding",
    profile: fixture.providers.embedding!.profile,
    target: failed.id,
    failedAt: new Date(),
  });
  await fixture
    .admin("memories")
    .where({ id: archived.id })
    .update({ status: "archived" });
  await fixture
    .admin("memories")
    .where({ id: expired.id })
    .update({
      retentionDays: 1,
      expiresAt: new Date(0),
      purgeAt: new Date(86400000),
    });
  const updated = (await list(100)).page.items;
  assert.equal(
    updated.find((item) => item.id === stale.id)?.indexing,
    "pending",
  );
  assert.equal(
    updated.find((item) => item.id === stale.id)?.enrichment?.status,
    "disabled",
  );
  assert.equal(
    updated.find((item) => item.id === failed.id)?.indexing,
    "failed",
  );
  assert.ok(
    !updated.some((item) => item.id === archived.id || item.id === expired.id),
  );
  const historical = await fixture.service.list(
    principal,
    listSchema.parse({ status: "archived" }),
  );
  assert.equal(historical.items[0].indexing, "disabled");
  assert.equal(historical.items[0].enrichment?.status, "disabled");
  await fixture
    .admin("accounts")
    .where({ id: principal.accountId })
    .update({ classificationEnabled: false, titlesTagsEnabled: false });
  assert.ok(
    (await list(100)).page.items.every(
      (item) =>
        item.enrichment?.status === "disabled" &&
        !item.enrichment.title &&
        !item.enrichment.suggestedKind &&
        !item.enrichment.tags.length,
    ),
  );
});
