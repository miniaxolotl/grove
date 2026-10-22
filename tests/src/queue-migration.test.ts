import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("populated 013 to 014 upgrade preserves authored rows and changes deletion without widening tenant access", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url),
    name = `grove_queue_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const connection = (uri: string) => {
    const parsed = new URL(uri);
    parsed.pathname = `/${name}`;
    return createDatabase(parsed.href);
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = connection(url),
    api = connection(process.env.TEST_DATABASE_URL!);
  try {
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          all.filter((m) => m.name < "20261022_014_queue_processing"),
      },
    });
    const accountId = randomUUID(),
      memoryId = randomUUID(),
      projectId = randomUUID();
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: `upgrade-${accountId}`,
    });
    await owner("projects").insert({
      id: projectId,
      accountId,
      name: "Retained notebook",
      identity: "retained",
    });
    await owner("memories").insert({
      id: memoryId,
      accountId,
      projectId,
      content: "Retained source",
      kind: "fact",
      source: {},
    });
    await owner("memory_revisions").insert({
      accountId,
      memoryId,
      version: 1,
      content: "Retained source",
      source: {},
    });
    const note = await owner("memories").where({ id: memoryId }).first();
    const revisions = await owner("memory_revisions").where({ memoryId });
    const [, applied] = await owner.migrate.latest();
    assert.deepEqual(applied, ["20261022_014_queue_processing"]);
    assert.deepEqual(await owner("memories").where({ id: memoryId }).first(), {
      ...note,
      deletedAt: null,
    });
    assert.deepEqual(
      await owner("memory_revisions").where({ memoryId }),
      revisions,
    );
    await tenant(api, accountId, (trx) =>
      trx("memories").where({ id: memoryId }).delete(),
    );
    assert((await owner("memories").where({ id: memoryId }).first()).deletedAt);
    assert.deepEqual(
      await owner("memory_revisions").where({ memoryId }),
      revisions,
    );
    assert.equal(
      (await tenant(api, accountId, (trx) => trx("memory_revisions"))).length,
      0,
    );
    assert.equal(
      (await tenant(api, randomUUID(), (trx) => trx("projects"))).length,
      0,
    );
    await tenant(api, accountId, (trx) =>
      trx("projects").where({ id: projectId }).delete(),
    );
    await tenant(api, accountId, (trx) =>
      trx("projects").insert({
        accountId,
        name: "New notebook",
        identity: "retained",
      }),
    );
    assert.equal((await owner("projects").where({ accountId })).length, 2);
  } finally {
    await Promise.all([owner.destroy(), api.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
