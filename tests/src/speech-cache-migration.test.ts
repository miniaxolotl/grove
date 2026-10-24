import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource } from "@lib/database";

test("023→024 preserves existing source and expiring artifacts without adopting legacy audio", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source);
  const name = `grove_cache_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const url = new URL(source);
  url.pathname = `/${name}`;
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(url.href);
  try {
    const migrations = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261024_024"),
      },
    });
    const [account] = await owner("accounts")
      .insert({ clerkSubject: randomUUID() })
      .returning("*");
    const [note] = await owner("memories")
      .insert({
        accountId: account.id,
        kind: "fact",
        content: "Retained text.",
        source: "{}",
      })
      .returning("*");
    const [task] = await owner("background_tasks")
      .insert({
        accountId: account.id,
        kind: "speech_synthesize",
        dedupeKey: randomUUID(),
        status: "succeeded",
      })
      .returning("*");
    const [artifact] = await owner("export_objects")
      .insert({
        objectKey: `speech/${account.id}/${task.id}/${randomUUID()}.mp3`,
        accountId: account.id,
        taskId: task.id,
      })
      .returning("*");
    await owner.migrate.up({ name: "20261024_024_speech_cache" });
    assert.deepEqual(
      await owner("memories").where({ id: note.id }).first(),
      note,
    );
    assert.deepEqual(
      await owner("background_tasks").where({ id: task.id }).first(),
      task,
    );
    const {
      speechMemoryId,
      speechTextHash,
      speechCacheKey,
      speechSha256,
      ...retained
    } = await owner("export_objects").first();
    assert.deepEqual(
      [speechMemoryId, speechTextHash, speechCacheKey, speechSha256],
      [null, null, null, null],
    );
    assert.deepEqual(retained, artifact);
    await owner("memories")
      .where({ id: note.id })
      .update({ content: "Edited text." });
    assert.deepEqual(
      (await owner("export_objects").first()).expiresAt,
      artifact.expiresAt,
    );
  } finally {
    await owner.destroy();
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
