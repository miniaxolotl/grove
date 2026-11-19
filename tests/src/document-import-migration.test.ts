import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  migrationSource,
  probeDatabase,
  tenant,
} from "@lib/database";

test("044→045 keeps an in-progress review and its notebook overrides", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url),
    name = `grove_import_choice_${randomUUID().replaceAll("-", "")}_test`;
  await authority.raw("CREATE DATABASE ??", [name]);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const db = createDatabase(target.href);
  const apiUrl = new URL(process.env.TEST_DATABASE_URL!);
  apiUrl.pathname = target.pathname;
  const runtime = createDatabase(apiUrl.href);
  try {
    const migrations = await migrationSource.getMigrations([]);
    await db.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261118_045"),
      },
    });
    const accountId = randomUUID(),
      batchId = randomUUID(),
      fileId = randomUUID();
    await db("accounts").insert({
      id: accountId,
      clerkSubject: "import_upgrade_fixture",
    });
    await db("document_import_batches").insert({
      accountId,
      id: batchId,
      status: "ready",
      version: 4,
    });
    await db("document_import_files").insert({
      accountId,
      batchId,
      id: fileId,
      filename: "journal.md",
      bytes: 1,
      sha256: "0".repeat(64),
    });
    await db("document_import_notes").insert({
      accountId,
      batchId,
      id: randomUUID(),
      fileId,
      ordinal: 0,
      content: "Journal",
      destination: { name: "Reviewed notebook", parentId: null },
      pageStart: 1,
      pageEnd: 1,
      sourceStart: 0,
      sourceEnd: 7,
    });
    const notes = await db("document_import_notes");
    await assert.rejects(probeDatabase(runtime), /initial_destination/);
    await db.migrate.latest();
    await probeDatabase(runtime);
    const batch = await db("document_import_batches")
      .where({ id: batchId })
      .first();
    assert.equal(batch.initialDestination, null);
    assert.equal(batch.version, 4);
    assert.deepEqual(await db("document_import_notes"), notes);
  } finally {
    await Promise.all([db.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});

test("030→031 preserves authored content and adds tenant-isolated import staging", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_documents_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (url: string) => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    return u.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source)),
    runtime = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    const names = migrations.map((entry) => entry.name);
    assert.deepEqual(
      names,
      [...names].sort(),
      "forward migrations retain their committed order",
    );
    assert.equal(
      new Set(names.map((name) => name.split("_").slice(0, 2).join("_"))).size,
      names.length,
      "migration sequence numbers are unique",
    );
    assert.equal(
      names[names.indexOf("20261025_030_conversation_context") + 1],
      "20261025_031_document_imports",
    );
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261025_031"),
      },
    });
    const a = randomUUID(),
      b = randomUUID(),
      note = randomUUID(),
      batch = randomUUID();
    await owner("accounts").insert([
      { id: a, clerkSubject: `upgrade_a_${a}` },
      { id: b, clerkSubject: `upgrade_b_${b}` },
    ]);
    await owner("memories").insert({
      accountId: a,
      id: note,
      kind: "fact",
      content: "Existing original writing",
      source: {},
    });
    const before = await owner("memories");
    await owner.migrate.latest();
    assert.deepEqual(await owner("memories"), before);
    await tenant(runtime, a, (trx) =>
      trx("document_import_batches").insert({ accountId: a, id: batch }),
    );
    assert.equal(
      (await tenant(runtime, b, (trx) => trx("document_import_batches")))
        .length,
      0,
    );
    await assert.rejects(
      tenant(runtime, b, (trx) =>
        trx("document_import_files").insert({
          accountId: b,
          batchId: batch,
          id: randomUUID(),
          filename: "private.txt",
          bytes: 4,
          sha256: "a".repeat(64),
          staging: Buffer.from("text"),
        }),
      ),
      /foreign key/,
    );
    await assert.rejects(
      tenant(runtime, a, (trx) => trx("document_import_batches").delete()),
      /permission denied/,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
