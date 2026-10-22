import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "@lib/database";
import { reconcileRestore } from "../../scripts/database/reconcile-restore.ts";
import { preferencesFor } from "@lib/shared/preferences";

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
    const notebookIds = [randomUUID(), randomUUID()].sort();
    const deletedChat = randomUUID(),
      retainedChat = randomUUID(),
      accountChat = randomUUID();
    for (const db of databases) {
      await db("accounts").insert([
        { id: a, clerkSubject: "recovery_a" },
        { id: b, clerkSubject: "recovery_b" },
      ]);
      await db("projects").insert(
        notebookIds.map((id) => ({
          accountId: a,
          id,
          name: "Recovery notebook",
          identity: id,
        })),
      );
      await db("notebook_relationships").insert({
        accountId: a,
        leftId: notebookIds[0],
        rightId: notebookIds[1],
        leftVersion: 0,
        rightVersion: 0,
        revision: "a".repeat(64),
        profile: "fixture",
        assessment: JSON.stringify({
          evidence: [{ quote: "Old derived passage" }],
          coverage: {},
        }),
      });
      await db("conversations").insert([
        { id: deletedChat, accountId: a, scope: "{}" },
        { id: retainedChat, accountId: a, scope: "{}" },
        { id: accountChat, accountId: b, scope: "{}" },
      ]);
      await db("conversation_turns").insert({
        id: randomUUID(),
        accountId: a,
        conversationId: retainedChat,
        position: 1,
        question: "Edit this note",
        fingerprint: "fixture",
        status: "pending",
        result: JSON.stringify({
          proposal: { status: "proposed", content: "Old preview" },
        }),
      });
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
      await db("embedding_profiles").insert({
        id: "fixture",
        model: "fixture",
        dimensions: 384,
      });
      await db("public_shares").insert({
        id: randomUUID(),
        accountId: a,
        memoryId: keep,
        tokenDigest: "f".repeat(64),
        tokenCiphertext: "encrypted-backup-fixture",
      });
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
        await db("jobs").insert({
          accountId,
          memoryId: id,
          version: 1,
          target: id,
        });
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
    await source("notebook_relationships")
      .where({ accountId: a })
      .update({ dismissedRevision: "a".repeat(64), reviewVersion: 1 });
    await source("deleted_conversations").insert({
      accountId: a,
      id: deletedChat,
    });
    await source("conversations")
      .whereIn("id", [deletedChat, accountChat])
      .delete();
    await source("memories")
      .whereIn("id", [forgotten, erasedAccountMemory])
      .delete();
    await source("accounts").where({ id: b }).update({
      status: "deleted",
      deletedAt: source.fn.now(),
      providerDeletedAt: source.fn.now(),
    });
    const preferences = preferencesFor({
      captureEnabled: false,
      titlesTagsEnabled: false,
      notebookConnectionsEnabled: false,
      personalSummaryEnabled: false,
      askEnabled: false,
    });
    await source("accounts").where({ id: a }).update(preferences);
    await source("subject_authority").insert({
      subject: "recovery_b",
      eventAt: "2000",
      deleted: true,
    });
    await source("session_revocations").insert({
      id: "session_revoked_after_snapshot",
    });
    await source("connections").update({ capabilities: ["memory:read"] });
    await source("public_shares").update({
      revokedAt: source.fn.now(),
      tokenDigest: null,
      tokenCiphertext: null,
    });
    const before = await source("accounts").orderBy("id");
    const result = await reconcileRestore(source, target);
    const recoveredReview = await target("notebook_relationships")
      .where({ accountId: a })
      .first();
    assert.equal(recoveredReview.dismissedRevision, "a".repeat(64));
    assert.equal(recoveredReview.reviewVersion, 2);
    assert.equal(recoveredReview.profile, "recovery-pending");
    assert.deepEqual(recoveredReview.assessment.evidence, []);
    assert.equal(result.softDeletedMemories, 2);
    assert.equal(result.blockedAccounts, 1);
    assert.equal(result.invalidatedShares, 1);
    const restoredShare = await target("public_shares").first();
    assert(restoredShare.revokedAt);
    assert.equal(restoredShare.tokenDigest, null);
    assert.equal(restoredShare.tokenCiphertext, null);
    assert.equal(
      (
        await target.raw(
          "SELECT grove_public_share(?, 'root', NULL, NULL, NULL, NULL, 30) AS value",
          ["f".repeat(64)],
        )
      ).rows[0].value,
      null,
    );
    assert.deepEqual(await source("accounts").orderBy("id"), before);
    assert.equal((await source("connections").first()).capabilities.length, 1);
    assert.deepEqual(
      await target("memories").whereNull("deletedAt").pluck("id"),
      [keep],
    );
    assert.equal(
      (await target("memories").whereNotNull("deletedAt")).length,
      2,
    );
    assert.deepEqual(
      await target("conversations").whereNull("deletedAt").pluck("id"),
      [retainedChat],
    );
    const restoredTurn = await target("conversation_turns").first();
    assert.equal(restoredTurn.status, "failed");
    assert.equal(restoredTurn.result.proposal.status, "unavailable");
    for (const table of [
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
    assert.deepEqual(
      preferencesFor(await target("accounts").where({ id: a }).first()),
      preferences,
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
    assert.equal(
      (await reconcileRestore(source, target)).softDeletedMemories,
      0,
    );
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
