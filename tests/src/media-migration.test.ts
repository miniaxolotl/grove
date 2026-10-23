import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("015→017 adds media without changing authored notes/history and retains non-owner isolation", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_media_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (input: string) => {
    const url = new URL(input);
    url.pathname = `/${name}`;
    return url.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source)),
    runtime = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261023_017"),
      },
    });
    const account = randomUUID(),
      other = randomUUID(),
      note = randomUUID();
    await owner("accounts").insert([
      { id: account, clerkSubject: "media_upgrade_a" },
      { id: other, clerkSubject: "media_upgrade_b" },
    ]);
    await owner("memories").insert({
      accountId: account,
      id: note,
      content: "Authored before attachments",
      kind: "fact",
      source: {},
    });
    await owner("memory_revisions").insert({
      accountId: account,
      memoryId: note,
      version: 1,
      content: "Authored before attachments",
      source: {},
    });
    const before = {
      notes: await owner("memories"),
      revisions: await owner("memory_revisions"),
    };
    const [, applied] = await owner.migrate.up({
      name: "20261023_017_media_attachments",
    });
    assert.deepEqual(applied, ["20261023_017_media_attachments"]);
    assert.deepEqual(
      {
        notes: await owner("memories"),
        revisions: await owner("memory_revisions"),
      },
      before,
    );
    const id = randomUUID();
    const row = {
      accountId: account,
      id,
      memoryId: note,
      mime: "image/png",
      bytes: 10,
      sha256: "0".repeat(64),
      objectKey: `media/${account}/${id}/${id}`,
      leaseId: id,
      leaseUntil: new Date(Date.now() + 60000),
    };
    await assert.rejects(
      tenant(runtime, other, (trx) => trx("media_objects").insert(row)),
      /row-level security/,
    );
    await tenant(runtime, account, (trx) => trx("media_objects").insert(row));
    assert.deepEqual(await runtime("media_objects"), []);
    assert.deepEqual(
      await tenant(runtime, other, (trx) => trx("media_objects")),
      [],
    );
    await assert.rejects(
      tenant(runtime, account, (trx) => trx("media_objects").delete()),
      /permission denied/,
    );
    assert.equal((await owner("media_objects")).length, 1);
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
