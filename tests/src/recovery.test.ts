import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "@lib/database";
import { reconcileRestore } from "../../scripts/database/reconcile-restore.ts";

test("isolated restore replays current deletions and revocations without changing authority", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  assert(
    url && new URL(url).pathname.endsWith("_test"),
    "Use a disposable test database",
  );
  const admin = createDatabase(url);
  const suffix = randomUUID().replaceAll("-", "");
  const names = [
    `grove_authority_${suffix}_test`,
    `grove_restore_${suffix}_test`,
  ];
  const databases = names.map((name) => {
    const connection = new URL(url);
    connection.pathname = `/${name}`;
    return createDatabase(connection.href);
  });
  const [source, target] = databases;
  const created: string[] = [];
  try {
    for (const [index, name] of names.entries()) {
      await admin.raw("CREATE DATABASE ??", [name]);
      created.push(name);
      await databases[index]!.migrate.latest();
    }
    const a = randomUUID(),
      b = randomUUID();
    const keep = randomUUID(),
      forgotten = randomUUID(),
      erasedAccountMemory = randomUUID();
    const connection = randomUUID();
    for (const db of databases) {
      await db("accounts").insert([
        { id: a, clerkSubject: "recovery_a" },
        { id: b, clerkSubject: "recovery_b" },
      ]);
      await db("memories").insert([
        {
          id: keep,
          accountId: a,
          kind: "fact",
          content: "Retained fixture",
          source: {},
        },
        {
          id: forgotten,
          accountId: a,
          kind: "fact",
          content: "Deleted after backup",
          source: {},
        },
        {
          id: erasedAccountMemory,
          accountId: b,
          kind: "fact",
          content: "Deleted account fixture",
          source: {},
        },
      ]);
      for (const [id, accountId] of [
        [forgotten, a],
        [erasedAccountMemory, b],
      ]) {
        await db("memory_revisions").insert({
          accountId,
          memoryId: id,
          version: 1,
          content: "Old content",
          source: {},
        });
        await db("memory_embeddings").insert({
          accountId,
          memoryId: id,
          version: 1,
          profile: "fixture",
          embedding: JSON.stringify(Array(384).fill(0)),
        });
        await db("jobs").insert({ accountId, memoryId: id, version: 1 });
        await db("memory_operations").insert({
          accountId,
          id: randomUUID(),
          fingerprint: "fixture",
          result: { content: "old response" },
        });
      }
      await db("connections").insert({
        id: connection,
        accountId: a,
        clientId: "restore-client",
        name: "Old grant",
        capabilities: ["memory:read", "memory:write"],
        personal: true,
      });
      await db("api_keys").insert({
        accountId: a,
        connectionId: connection,
        digest: "fixture",
        prefix: "fixture",
      });
    }
    await source("deleted_memories").insert({ accountId: a, id: forgotten });
    await source("memories")
      .whereIn("id", [forgotten, erasedAccountMemory])
      .delete();
    await source("accounts")
      .where({ id: b })
      .update({
        status: "deleted",
        deletedAt: source.fn.now(),
        providerDeletedAt: source.fn.now(),
      });
    await source("accounts").where({ id: a }).update({ captureEnabled: false });
    await source("subject_authority").insert({
      subject: "recovery_b",
      eventAt: "2000",
      deleted: true,
    });
    await source("session_revocations").insert({
      id: "session_revoked_after_snapshot",
    });
    await source("connections").update({ capabilities: ["memory:read"] });
    const before = await source("accounts").orderBy("id");
    const result = await reconcileRestore(source, target);
    assert.equal(result.purgedMemories, 2);
    assert.equal(result.blockedAccounts, 1);
    assert.deepEqual(await source("accounts").orderBy("id"), before);
    assert.equal((await source("connections").first()).capabilities.length, 1);
    assert.deepEqual(await target("memories").pluck("id"), [keep]);
    for (const table of [
      "memory_revisions",
      "memory_embeddings",
      "jobs",
      "memory_operations",
      "api_keys",
    ])
      assert.equal(
        (await target(table)).length,
        0,
        `${table} must not retain deleted material`,
      );
    const grant = await target("connections").first();
    assert(grant.revokedAt);
    assert.deepEqual(grant.capabilities, []);
    assert.equal(
      (await target("accounts").where({ id: b }).first()).status,
      "deleted",
    );
    assert.equal(
      (await target("accounts").where({ id: a }).first()).captureEnabled,
      false,
    );
    assert.equal(
      (
        await target("subject_authority")
          .where({ subject: "recovery_b" })
          .first()
      ).deleted,
      true,
    );
    assert.equal(
      (
        await target.raw("SELECT grove_session_revoked(?) AS revoked", [
          "session_revoked_after_snapshot",
        ])
      ).rows[0].revoked,
      true,
    );
    await target.transaction(async (trx) => {
      await trx.raw("SET LOCAL ROLE grove_runtime");
      await trx.raw("SELECT set_config('grove.account_id', ?, true)", [b]);
      assert.equal((await trx("memories")).length, 0);
      await trx.raw("SELECT set_config('grove.account_id', ?, true)", [a]);
      assert.deepEqual(await trx("memories").pluck("id"), [keep]);
    });
    assert.equal((await reconcileRestore(source, target)).purgedMemories, 0);
    await target("accounts").insert({
      clerkSubject: "unexpected_recovery_account",
    });
    await assert.rejects(
      reconcileRestore(source, target),
      /absent from the current authority/,
    );
  } finally {
    await Promise.all(databases.map((db) => db.destroy()));
    for (const name of created) await admin.raw("DROP DATABASE ??", [name]);
    await admin.destroy();
  }
});
