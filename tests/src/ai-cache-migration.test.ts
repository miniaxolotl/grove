import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("AI cache upgrade preserves authored data and provider counts and gives old split actions full usage units", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_cache_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (value: string) => {
    const uri = new URL(value);
    uri.pathname = `/${name}`;
    return uri.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url));
  const db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const old = migrations.filter((m) => m.name < "20261025_029");
    const migrationSource: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () => old,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await admin.migrate.latest({ migrationSource });
    const { rows } = await db.raw("SELECT * FROM grove_account(?)", [
      randomUUID(),
    ]);
    const accountId = rows[0].id;
    await tenant(db, accountId, async (trx) => {
      await trx("memories").insert({
        accountId,
        content: "Retained cache-upgrade note",
        kind: "fact",
        source: { agent: "api" },
      });
      await trx("inference_usage").insert({
        accountId,
        role: "generation",
        requests: 37,
        inputTokens: 1234,
      });
      await trx("action_usage").insert({
        accountId,
        metric: "ask",
        operation: "legacy",
        status: "completed",
        period: "2026-10-01",
        leaseId: randomUUID(),
        leaseUntil: new Date(),
      });
    });
    const notes = await admin("memories");
    const providers = await admin("inference_usage");
    const actions = await admin("action_usage");
    await admin.migrate.latest();
    assert.deepEqual(await admin("memories"), notes);
    assert.deepEqual(await admin("inference_usage"), providers);
    assert.deepEqual(
      (await admin("action_usage")).map(({ units, ...row }) => {
        assert.equal(units, 5);
        return row;
      }),
      actions,
    );
    assert.deepEqual(await tenant(db, accountId, (trx) => trx("ai_cache")), []);
    assert.deepEqual(await admin("billing_subscriptions"), []);
  } finally {
    await Promise.all([db.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
