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
    const pendingMedia = randomUUID();
    const removedDocument = randomUUID(),
      unsentDocument = randomUUID();
    const importBatch = randomUUID(),
      importFile = randomUUID();
    const speechTranscript = randomUUID(),
      speechAudio = randomUUID();
    const speechKey = `speech/${a}/${speechAudio}/${randomUUID()}.mp3`;
    const notebookIds = [randomUUID(), randomUUID()].sort();
    const assistanceId = randomUUID();
    const deletedChat = randomUUID(),
      retainedChat = randomUUID(),
      accountChat = randomUUID();
    for (const db of databases) {
      await db("accounts").insert([
        { id: a, clerkSubject: "recovery_a" },
        { id: b, clerkSubject: "recovery_b" },
      ]);
      await db("document_import_batches").insert({
        accountId: a,
        id: importBatch,
        status: "ready",
      });
      await db("document_import_files").insert({
        accountId: a,
        batchId: importBatch,
        id: importFile,
        filename: "draft.txt",
        bytes: 11,
        sha256: "a".repeat(64),
        staging: Buffer.from("Old preview"),
      });
      await db("document_import_notes").insert({
        accountId: a,
        batchId: importBatch,
        fileId: importFile,
        id: randomUUID(),
        ordinal: 0,
        content: "Old preview",
        pageStart: 1,
        pageEnd: 1,
        sourceStart: 0,
        sourceEnd: 11,
      });
      await db("background_tasks").insert([
        {
          id: speechTranscript,
          accountId: a,
          kind: "speech_transcribe",
          dedupeKey: speechTranscript,
          status: "succeeded",
          result: JSON.stringify({
            transcript: "Unaccepted machine suggestion",
          }),
          expiresAt: db.raw("now()+interval '1 day'"),
        },
        {
          id: speechAudio,
          accountId: a,
          kind: "speech_synthesize",
          dedupeKey: speechAudio,
          status: "succeeded",
          result: JSON.stringify({ key: speechKey, bytes: 100 }),
          expiresAt: db.raw("now()+interval '1 day'"),
        },
      ]);
      await db("export_objects").insert({
        objectKey: speechKey,
        accountId: a,
        taskId: speechAudio,
        bytes: 100,
      });
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
          organization: { status: "proposed", notebooks: [] },
          lifecycle: {
            status: "proposed",
            action: "delete",
            notes: [],
            notebooks: [],
          },
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
      await db("media_objects").insert({
        accountId: a,
        id: pendingMedia,
        memoryId: keep,
        mime: "image/png",
        bytes: 10,
        sha256: "a".repeat(64),
        objectKey: `media/${a}/${pendingMedia}/${pendingMedia}`,
        leaseId: pendingMedia,
        leaseUntil: new Date(Date.now() + 60000),
      });
      await db("embedding_profiles").insert({
        id: "fixture",
        model: "fixture",
        dimensions: 384,
      });
      await db("assistance_requests").insert({
        accountId: a,
        id: assistanceId,
        kind: "actions",
        profile: "fixture",
        fingerprint: "fixture",
        input: JSON.stringify({
          id: assistanceId,
          kind: "actions",
          sources: [{ id: keep, version: 1 }],
          projectId: null,
        }),
        status: "ready",
        result: JSON.stringify({ items: [{ text: "Old generated passage" }] }),
      });
      await db("notebook_checkpoints").insert({
        accountId: a,
        projectId: notebookIds[0],
        token: "1",
      });
      await db("assistance_reviews").insert({
        accountId: a,
        key: "pair",
        dismissed: false,
        version: 1,
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
    await source("account_administration").insert({
      accountId: a,
      role: "user",
      access: "default",
      version: 3,
    });
    await target("account_administration").insert({
      accountId: a,
      role: "system_admin",
      access: "unlimited",
      version: 1,
    });
    await source("deleted_memories").insert({ accountId: a, id: forgotten });
    await source("assistance_requests")
      .where({ id: assistanceId })
      .update({
        status: "applied",
        version: 3,
        applied: JSON.stringify([{ id: keep, version: 2 }]),
        result: null,
      });
    await source("assistance_reviews")
      .where({ accountId: a, key: "pair" })
      .update({ dismissed: true, version: 2 });
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
    await source("accounts")
      .where({ id: a })
      .update({ ...preferences, readAloudVoiceId: "cedar" });
    await source("accounts")
      .where({ id: a })
      .update({
        askTools: JSON.stringify({ exa: false, tavily: true, organize: false }),
      });
    await source("research_global_usage").insert({
      month: "2026-10-01",
      microdollars: 12000,
    });
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
    for (const db of databases) {
      const taskId = randomUUID();
      await db("background_tasks").insert({
        id: taskId,
        accountId: a,
        kind: "conversation_document",
        dedupeKey: taskId,
      });
      await db("conversation_documents").insert([
        {
          id: removedDocument,
          accountId: a,
          conversationId: retainedChat,
          taskId,
          filename: "private.txt",
          bytes: 4,
          sha256: "a".repeat(64),
          status: "ready",
          accepted: true,
          objectKey: `media/${a}/${removedDocument}/${taskId}`,
        },
        {
          id: unsentDocument,
          accountId: a,
          conversationId: retainedChat,
          taskId,
          filename: "unsent.txt",
          bytes: 4,
          sha256: "b".repeat(64),
          staging: Buffer.from("text"),
        },
      ]);
    }
    await source("conversation_documents")
      .where({ id: removedDocument })
      .update({ removedAt: source.fn.now() });
    const result = await reconcileRestore(source, target);
    const restoredOrder = await target("accounts").where({ id: a }).first();
    const authorityOrder = await source("accounts").where({ id: a }).first();
    assert(
      BigInt(restoredOrder.notebookOrderVersion ?? 0) >
        BigInt(authorityOrder.notebookOrderVersion ?? 0),
      "recovery fences every pre-restore notebook layout token",
    );
    assert(
      (
        await target("conversation_documents")
          .where({ id: removedDocument })
          .first()
      ).removedAt,
      "restore must retain current document revocation",
    );
    assert.equal(
      (
        await target("conversation_documents")
          .where({ id: unsentDocument })
          .first()
      ).staging,
      null,
    );
    assert.equal(
      (
        await target("document_import_batches")
          .where({ id: importBatch })
          .first()
      ).status,
      "cancelled",
    );
    assert.equal(
      (await target("document_import_files").where({ id: importFile }).first())
        .staging,
      null,
    );
    assert.equal(
      (
        await source("document_import_batches")
          .where({ id: importBatch })
          .first()
      ).status,
      "ready",
    );
    assert.deepEqual(
      await target("account_administration").where({ accountId: a }).first(),
      await source("account_administration").where({ accountId: a }).first(),
      "restores must not resurrect revoked system roles or access grants",
    );
    assert.equal(
      (await target("accounts").where({ id: a }).first()).readAloudVoiceId,
      "cedar",
    );
    for (const id of [speechTranscript, speechAudio]) {
      const task = await target("background_tasks").where({ id }).first();
      assert.equal(task.result, null);
      assert(new Date(task.expiresAt).getTime() <= Date.now());
    }
    assert(
      new Date(
        (await target("export_objects").where({ objectKey: speechKey }).first())
          .expiresAt,
      ).getTime() <= Date.now(),
    );
    assert.equal(
      (await target("media_objects").where({ id: pendingMedia }).first())
        .status,
      "failed",
    );
    assert.equal(
      (await source("media_objects").where({ id: pendingMedia }).first())
        .status,
      "pending",
    );
    const operation = await target("assistance_requests")
      .where({ id: assistanceId })
      .first();
    assert.equal(operation.status, "stale");
    assert.equal(operation.result, null);
    assert.equal(operation.undo, null);
    assert.deepEqual(operation.applied, [{ id: keep, version: 2 }]);
    assert.equal(
      (
        await target("assistance_reviews")
          .where({ accountId: a, key: "pair" })
          .first()
      ).dismissed,
      true,
    );
    assert.equal((await target("notebook_checkpoints")).length, 0);
    assert(
      BigInt((await target("accounts").where({ id: a }).first()).changeToken) >
        BigInt(before.find((r) => r.id === a)!.changeToken),
    );
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
    assert.equal(restoredTurn.result.organization.status, "unavailable");
    assert.equal(restoredTurn.result.lifecycle.status, "unavailable");
    assert.equal(
      (await target("accounts").where({ id: a }).first()).askTools.exa,
      false,
    );
    assert.equal(
      Number((await target("research_global_usage").first()).microdollars),
      12000,
    );
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

test("restore preserves current support suspension and notes instead of reviving backup access", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url),
    names = [
      `support_authority_${randomUUID().replaceAll("-", "")}_test`,
      `support_restore_${randomUUID().replaceAll("-", "")}_test`,
    ];
  const databases = names.map((name) => {
    const target = new URL(url);
    target.pathname = "/" + name;
    return createDatabase(target.href);
  });
  try {
    for (const [index, name] of names.entries()) {
      await authority.raw("CREATE DATABASE ??", [name]);
      await databases[index].migrate.latest();
    }
    const [source, target] = databases;
    const id = randomUUID();
    for (const db of databases)
      await db("accounts").insert({ id, clerkSubject: "support_restore_user" });
    await source("accounts").where({ id }).update({
      status: "disabled",
      adminSuspended: true,
      captureEnabled: false,
    });
    await source("account_administration").insert({
      accountId: id,
      supportNote: "Review suspension before restoring access",
      version: 2,
    });
    await reconcileRestore(source, target);
    const restored = await target("accounts").where({ id }).first();
    assert.equal(restored.adminSuspended, true);
    assert.equal(restored.status, "disabled");
    assert.equal(restored.captureEnabled, false);
    assert.equal(
      (await target("account_administration").where({ accountId: id }).first())
        .supportNote,
      "Review suspension before restoring access",
    );
  } finally {
    await Promise.all(databases.map((db) => db.destroy()));
    for (const name of names)
      await authority.raw("DROP DATABASE IF EXISTS ??", [name]);
    await authority.destroy();
  }
});
