import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("022→023 preserves retained accounts, notes and usage while adding isolated empty billing state", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_billing_upgrade_${randomUUID().replaceAll("-", "")}_test`;
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
          migrations.filter((m) => m.name < "20261024_023"),
      },
    });
    const accountId = randomUUID();
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: randomUUID(),
    });
    await owner("memories").insert({
      id: randomUUID(),
      accountId,
      content: "Keep authored history.",
      kind: "fact",
      source: { agent: "website" },
    });
    await owner("inference_usage").insert({
      accountId,
      role: "generation",
      requests: 21,
      inputTokens: 42,
    });
    const before = await Promise.all([
      owner("accounts"),
      owner("memories"),
      owner("inference_usage"),
    ]);
    const migration = migrations.find((m) => m.name === "20261024_023_billing");
    assert(migration);
    await owner.migrate.up({ name: migration.name });
    assert.deepEqual(
      await Promise.all([
        owner("accounts"),
        owner("memories"),
        owner("inference_usage"),
      ]),
      before,
    );
    assert.equal((await owner("billing_customers")).length, 0);
    assert.equal(
      (await tenant(runtime, accountId, (trx) => trx("billing_subscriptions")))
        .length,
      0,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
