import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";
import { reconcileRestore } from "../../scripts/database/reconcile-restore.ts";

test("populated 015 to 016 upgrade preserves authored data, defaults notebooks active and keeps tenant isolation", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url),
    name = `grove_notebook_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const parsed = new URL(uri);
    parsed.pathname = `/${name}`;
    return createDatabase(parsed.href);
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = target(url),
    runtime = target(process.env.TEST_DATABASE_URL!);
  try {
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () => all.filter((m) => m.name < "20261023_016"),
      },
    });
    const accountId = randomUUID(),
      parent = randomUUID(),
      child = randomUUID(),
      memoryId = randomUUID();
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: `upgrade_${accountId}`,
    });
    await owner("projects").insert({
      id: parent,
      accountId,
      name: "Parent",
      identity: parent,
    });
    await owner("projects").insert({
      id: child,
      accountId,
      name: "Child",
      identity: child,
      parentId: parent,
    });
    await owner("memories").insert({
      id: memoryId,
      accountId,
      projectId: child,
      kind: "fact",
      content: "Retained text",
      source: "{}",
    });
    await owner("memory_revisions").insert({
      memoryId,
      accountId,
      version: 1,
      content: "Retained text",
      source: "{}",
    });
    const notes = await owner("memories"),
      projects = await owner("projects"),
      revisions = await owner("memory_revisions");
    const [, applied] = await owner.migrate.latest();
    assert.deepEqual(applied, ["20261023_016_notebook_lifecycle"]);
    assert.deepEqual(
      await owner("memories"),
      notes.map((row) => ({ ...row, archiveOperationId: null })),
    );
    assert.deepEqual(
      await owner("projects"),
      projects.map((row) => ({
        ...row,
        status: "active",
        archiveOperationId: null,
      })),
    );
    assert.deepEqual(await owner("memory_revisions"), revisions);
    assert.equal(
      (await tenant(runtime, randomUUID(), (trx) => trx("projects"))).length,
      0,
    );
    assert.equal(
      (await tenant(runtime, accountId, (trx) => trx("projects"))).length,
      2,
    );
    await tenant(runtime, accountId, (trx) =>
      trx("memories").where({ id: memoryId }).delete(),
    );
    await tenant(runtime, accountId, (trx) =>
      trx("projects").whereIn("id", [parent, child]).delete(),
    );
    assert.equal((await owner("projects")).length, 2);
    assert.deepEqual(await owner("memory_revisions"), revisions);
    assert.equal(
      (await tenant(runtime, accountId, (trx) => trx("projects"))).length,
      0,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});

test("recovery replays a notebook subtree's soft deletions without erasing restored note history", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url),
    suffix = randomUUID().replaceAll("-", "");
  const names = [
    `grove_notebook_authority_${suffix}_test`,
    `grove_notebook_restore_${suffix}_test`,
  ];
  const databases = names.map((name) => {
    const target = new URL(url);
    target.pathname = `/${name}`;
    return createDatabase(target.href);
  });
  const [source, restored] = databases;
  const created: string[] = [];
  try {
    const accountId = randomUUID(),
      root = randomUUID(),
      child = randomUUID(),
      memoryId = randomUUID();
    for (const [index, name] of names.entries()) {
      await authority.raw("CREATE DATABASE ??", [name]);
      created.push(name);
      const db = databases[index];
      await db.migrate.latest();
      await db("accounts").insert({
        id: accountId,
        clerkSubject: `recovery_${accountId}`,
      });
      await db("projects").insert({
        id: root,
        accountId,
        name: "Root",
        identity: root,
      });
      await db("projects").insert({
        id: child,
        accountId,
        name: "Child",
        identity: child,
        parentId: root,
      });
      await db("memories").insert({
        id: memoryId,
        accountId,
        projectId: child,
        kind: "fact",
        content: "Retained history",
        source: "{}",
      });
      await db("memory_revisions").insert({
        memoryId,
        accountId,
        version: 1,
        content: "Retained history",
        source: "{}",
      });
    }
    await source("memories")
      .where({ id: memoryId })
      .update({ deletedAt: source.fn.now(), status: "archived" });
    await source("projects")
      .whereIn("id", [root, child])
      .update({ deletedAt: source.fn.now() });
    await reconcileRestore(source, restored);
    assert.equal(
      (await restored("projects").whereNotNull("deletedAt")).length,
      2,
    );
    assert(
      (await restored("memories").where({ id: memoryId }).first()).deletedAt,
    );
    assert.equal(
      (await restored("memory_revisions").where({ memoryId }).first()).content,
      "Retained history",
    );
  } finally {
    await Promise.all(databases.map((db) => db.destroy()));
    for (const name of created)
      await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
