import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("018→019 preserves authored recordings/transcripts, defaults speech off and scopes worker checks", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_speech_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (input: string) => {
    const url = new URL(input);
    url.pathname = `/${name}`;
    return url.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source)),
    runtime = createDatabase(target(process.env.TEST_DATABASE_URL!)),
    worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261023_019"),
      },
    });
    const account = randomUUID(),
      other = randomUUID(),
      note = randomUUID(),
      media = randomUUID();
    await owner("accounts").insert([
      { id: account, clerkSubject: "speech_upgrade_a", askEnabled: false },
      { id: other, clerkSubject: "speech_upgrade_b" },
    ]);
    await owner("memories").insert({
      accountId: account,
      id: note,
      content: "Original recording",
      kind: "fact",
      source: {},
    });
    await owner("memory_revisions").insert({
      accountId: account,
      memoryId: note,
      version: 1,
      content: "Original recording",
      source: {},
    });
    await owner("media_objects").insert({
      accountId: account,
      memoryId: note,
      id: media,
      mime: "audio/wav",
      status: "ready",
      durationMs: 1000,
      bytes: 32044,
      sha256: "a".repeat(64),
      objectKey: `media/${account}/${media}/${media}`,
      leaseId: media,
      leaseUntil: new Date(Date.now() + 60000),
    });
    await owner("media_transcripts").insert({
      accountId: account,
      mediaId: media,
      text: "My own transcript",
      version: 1,
      operationId: randomUUID(),
      fingerprint: "existing",
    });
    await owner("media_transcript_revisions").insert({
      accountId: account,
      mediaId: media,
      version: 1,
      text: "My own transcript",
    });
    const tables = [
      "memories",
      "memory_revisions",
      "media_objects",
      "media_transcripts",
      "media_transcript_revisions",
    ];
    const before = await Promise.all(tables.map((table) => owner(table)));
    const [, applied] = await owner.migrate.up({ name: "20261023_019_speech" });
    assert.deepEqual(applied, ["20261023_019_speech"]);
    assert.deepEqual(
      await Promise.all(tables.map((table) => owner(table))),
      before,
    );
    const existing = await owner("accounts").where({ id: account }).first();
    assert.equal(existing.askEnabled, false);
    assert.equal(existing.transcriptionEnabled, false);
    assert.equal(existing.readAloudEnabled, false);
    await assert.rejects(
      tenant(runtime, other, (trx) =>
        trx("speech_usage").insert({
          accountId: account,
          kind: "speech_transcribe",
          requests: 1,
          units: 1000,
        }),
      ),
      /row-level security/,
    );
    await assert.rejects(worker("speech_slots"), /permission denied/);
    await assert.rejects(
      worker("speech_configuration").update({ synthesis: "changed" }),
      /permission denied/,
    );
    const id = randomUUID();
    await tenant(runtime, account, (trx) =>
      trx("background_tasks").insert({
        id,
        accountId: account,
        kind: "speech_transcribe",
        dedupeKey: id,
        payload: JSON.stringify({ sessionId: "owner_session" }),
      }),
    );
    const visible = await tenant(worker, account, (trx) =>
      trx.raw("SELECT grove_speech_session_active(?::uuid) AS active", [id]),
    );
    const hidden = await tenant(worker, other, (trx) =>
      trx.raw("SELECT grove_speech_session_active(?::uuid) AS active", [id]),
    );
    assert.equal(visible.rows[0].active, true);
    assert.equal(hidden.rows[0].active, false);
    await tenant(runtime, account, (trx) =>
      trx("accounts")
        .where({ id: account })
        .update({ transcriptionEnabled: true }),
    );
    await tenant(runtime, account, (trx) =>
      trx("accounts")
        .where({ id: account })
        .update({ transcriptionEnabled: false }),
    );
    assert.equal(
      (await owner("accounts").where({ id: account }).first())
        .transcriptionVersion,
      2,
    );
    assert.equal(
      (await owner("background_tasks").where({ id }).first()).status,
      "cancelled",
    );
    assert.deepEqual(
      await Promise.all(tables.map((table) => owner(table))),
      before,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy(), worker.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
