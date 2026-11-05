import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  tenant,
  probeDatabase,
  type Knex,
} from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";
import { MemoryService, sessionPrincipal } from "@lib/memory";

test("populated structured-document upgrade preserves raw history and real-role isolation", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_documents_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const u = new URL(uri);
    u.pathname = `/${name}`;
    return u.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url)),
    db = createDatabase(target(process.env.TEST_DATABASE_URL!)),
    worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    const source: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () =>
        migrations.filter((m) => m.name < "20261105_036"),
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await admin.migrate.latest({ migrationSource: source });
    const accountId = randomUUID(),
      id = randomUUID(),
      subject = `upgrade_${accountId}`;
    await admin("accounts").insert({ id: accountId, clerkSubject: subject });
    const content = "# Legacy\r\n\r\nOriginal.\r\n\r\nUnchanged.";
    await tenant(db, accountId, async (trx) => {
      await trx("memories").insert({
        id,
        accountId,
        content,
        kind: "fact",
        source: { agent: "api" },
      });
      await trx("memory_revisions").insert({
        accountId,
        memoryId: id,
        version: 1,
        content,
        source: { agent: "api" },
      });
    });
    const before = await admin("memories");
    await assert.rejects(() => probeDatabase(db), /document|actor|column/);
    await admin.migrate.latest();
    await probeDatabase(db);
    await probeDatabase(worker);
    assert.deepEqual(await admin("memories"), before);
    assert.equal((await admin("memory_revisions").first()).document, null);
    const service = new MemoryService(db, "migration-document-secret"),
      principal = sessionPrincipal(accountId, subject);
    const a = await service.getMemoryDocument(principal, id),
      b = await service.getMemoryDocument(principal, id);
    assert.deepEqual(
      a,
      b,
      "legacy read IDs are deterministic without rewriting history",
    );
    await service.updateMemory(principal, {
      id,
      operationId: randomUUID(),
      expectedVersion: 1,
      content: content.replace("Original", "Changed"),
      capture: "explicit",
    });
    assert.equal(
      (await admin("memory_revisions").where({ version: 1 }).first()).content,
      content,
    );
    assert(
      (await admin("memory_revisions").where({ version: 2 }).first()).document,
    );
    for (const runtime of [db, worker]) {
      assert.equal(
        (await tenant(runtime, randomUUID(), (trx) => trx("memory_revisions")))
          .length,
        0,
      );
      await assert.rejects(
        () =>
          tenant(runtime, accountId, (trx) =>
            trx("memory_revisions").insert({
              accountId,
              memoryId: id,
              version: 3,
              content: "Wrong projection",
              source: { agent: "api" },
              document: JSON.stringify({ ...a, revision: 3 }),
            }),
          ),
        /revision_document_projection/,
      );
      await assert.rejects(
        () =>
          tenant(runtime, accountId, (trx) =>
            trx("memory_revisions").insert({
              accountId,
              memoryId: id,
              version: 3,
              content: "Invalid group",
              source: { agent: "api" },
              revisionGroup: JSON.stringify({ start: 99, number: 2 }),
            }),
          ),
        /revision_group_bounds/,
      );
    }
  } finally {
    await Promise.all([db.destroy(), worker.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
