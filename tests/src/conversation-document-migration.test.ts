import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  migrationSource,
  tenant,
  probeDatabase,
} from "@lib/database";

test("031→032 preserves notes, import drafts and chat history with isolated document tables", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_chat_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (value: string) => {
    const url = new URL(value);
    url.pathname = `/${name}`;
    return url.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source)),
    runtime = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    const names = migrations.map((entry) => entry.name);
    assert.deepEqual(names, [...names].sort());
    assert.equal(
      new Set(names.map((entry) => entry.split("_").slice(0, 2).join("_")))
        .size,
      names.length,
    );
    assert.equal(
      names[names.indexOf("20261025_031_document_imports") + 1],
      "20261025_032_conversation_documents",
    );
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261025_032"),
      },
    });
    const a = randomUUID(),
      b = randomUUID(),
      chat = randomUUID(),
      task = randomUUID(),
      document = randomUUID(),
      batch = randomUUID();
    await owner("accounts").insert([
      { id: a, clerkSubject: `upgrade_${a}` },
      { id: b, clerkSubject: `upgrade_${b}` },
    ]);
    await owner("memories").insert({
      id: randomUUID(),
      accountId: a,
      kind: "fact",
      content: "Existing writing",
      source: {},
    });
    await owner("conversations").insert({
      id: chat,
      accountId: a,
      title: "Existing chat",
      scope: { includePersonal: false },
    });
    await owner("document_import_batches").insert({ id: batch, accountId: a });
    await owner("document_import_files").insert({
      id: randomUUID(),
      batchId: batch,
      accountId: a,
      filename: "draft.txt",
      bytes: 4,
      sha256: "a".repeat(64),
      staging: Buffer.from("text"),
    });
    const tables = [
        "memories",
        "memory_revisions",
        "document_import_batches",
        "document_import_files",
      ],
      before = await Promise.all(tables.map((table) => owner(table)));
    const oldChat = await owner("conversations").first();
    await assert.rejects(
      probeDatabase(runtime),
      /documents_version|conversation_documents/,
    );
    await owner.migrate.latest();
    await probeDatabase(runtime);
    assert.deepEqual(
      await Promise.all(tables.map((table) => owner(table))),
      before,
    );
    const upgraded = await owner("conversations").first();
    assert.deepEqual(upgraded, { ...oldChat, documentsVersion: 0 });
    await owner("background_tasks").insert({
      id: task,
      accountId: a,
      kind: "conversation_document",
      dedupeKey: task,
    });
    await tenant(runtime, a, (trx) =>
      trx("conversation_documents").insert({
        id: document,
        accountId: a,
        conversationId: chat,
        taskId: task,
        filename: "oak.txt",
        bytes: 4,
        sha256: "a".repeat(64),
        staging: Buffer.from("text"),
      }),
    );
    for (const table of [
      "conversation_documents",
      "conversation_document_chunks",
      "conversation_document_attempts",
      "conversation_document_bindings",
      "conversation_document_handoffs",
    ]) {
      assert.equal((await tenant(runtime, b, (trx) => trx(table))).length, 0);
      await assert.rejects(
        tenant(runtime, a, (trx) => trx(table).delete()),
        /permission denied/,
      );
    }
    await assert.rejects(
      tenant(runtime, b, (trx) =>
        trx("conversation_document_chunks").insert({
          id: randomUUID(),
          accountId: b,
          documentId: document,
          ordinal: 0,
          content: "Forged",
          pageStart: 1,
          pageEnd: 1,
          sourceStart: 0,
          sourceEnd: 6,
        }),
      ),
      /foreign key/,
    );
    await assert.rejects(
      runtime.raw("SELECT grove_clear_chat_uploads()"),
      /permission denied/,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
