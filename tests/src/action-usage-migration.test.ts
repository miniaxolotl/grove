import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("the action-usage upgrade adds isolated empty counters without reinterpreting retained provider usage", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_action_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const parsed = new URL(uri);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url));
  const db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  const worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    const before = migrations.filter((m) => m.name < "20261025_028");
    const migrationSource: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () => before,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await admin.migrate.latest({ migrationSource });
    const accountId = randomUUID();
    await admin("accounts").insert({
      id: accountId,
      clerkSubject: `upgrade_${accountId}`,
    });
    await tenant(db, accountId, async (trx) => {
      await trx("inference_usage").insert({
        accountId,
        role: "generation",
        requests: 73,
        inputTokens: 35000,
        outputTokens: 1000,
      });
      await trx("memories").insert({
        accountId,
        content: "Retained migration content",
        kind: "fact",
        source: { agent: "api" },
      });
    });
    const notes = await admin("memories").select("*");
    const usage = await admin("inference_usage").select("*");
    await admin.migrate.latest();
    assert.deepEqual(await admin("memories").select("*"), notes);
    assert.deepEqual(await admin("inference_usage").select("*"), usage);
    assert.deepEqual(await admin("action_usage"), []);
    for (const runtime of [db, worker]) {
      await tenant(runtime, accountId, (trx) =>
        trx("action_usage").insert({
          accountId,
          metric: "ask",
          operation: randomUUID(),
          period: "2026-10-01",
          status: "reserved",
          leaseId: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000),
        }),
      );
      await assert.rejects(
        tenant(runtime, randomUUID(), (trx) =>
          trx("action_usage").insert({
            accountId,
            metric: "ask",
            operation: randomUUID(),
            period: "2026-10-01",
            status: "reserved",
            leaseId: randomUUID(),
            leaseUntil: new Date(),
          }),
        ),
        /row-level security/,
      );
      assert.equal(
        (await tenant(runtime, randomUUID(), (trx) => trx("action_usage")))
          .length,
        0,
      );
    }
  } finally {
    await Promise.all([db.destroy(), worker.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
