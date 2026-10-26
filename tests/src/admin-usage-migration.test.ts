import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, probeDatabase, type Knex } from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("report upgrade preserves retained content, counters and all tenant policies", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_report_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = new URL(url);
  target.pathname = `/${name}`;
  await authority.raw("CREATE DATABASE ??", [name]);
  const db = createDatabase(target.href);
  const apiTarget = new URL(process.env.TEST_DATABASE_URL!);
  apiTarget.pathname = `/${name}`;
  const runtime = createDatabase(apiTarget.href);
  try {
    const previous = migrations.filter((m) => m.name < "20261025_034");
    const migrationSource: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () => previous,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await db.migrate.latest({ migrationSource });
    const accountId = randomUUID();
    await db("accounts").insert({
      id: accountId,
      clerkSubject: `report_${accountId}`,
    });
    await db("memories").insert({
      accountId,
      content: "Retained original report-upgrade note",
      kind: "fact",
      source: {},
    });
    await db("inference_usage").insert({
      accountId,
      day: "2026-08-15",
      role: "generation",
      requests: 13,
      inputTokens: 456,
    });
    await db("action_usage").insert({
      accountId,
      period: "2026-08-01",
      metric: "ask",
      operation: randomUUID(),
      status: "completed",
      units: 1,
      leaseId: randomUUID(),
      leaseUntil: new Date(),
    });
    const tables = [
      "accounts",
      "memories",
      "action_usage",
      "inference_usage",
      "speech_usage",
      "billing_subscriptions",
    ];
    const before = await Promise.all(
      tables.map((table) => db(table).select("*")),
    );
    const policies = () =>
      db.raw(
        "SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies ORDER BY schemaname,tablename,policyname",
      );
    const oldPolicies = (await policies()).rows;
    await assert.rejects(probeDatabase(runtime), /usage-report migration/);
    await db.migrate.latest();
    await probeDatabase(runtime);
    for (let i = 0; i < tables.length; i++)
      assert.deepEqual(await db(tables[i]), before[i], tables[i]);
    assert.deepEqual((await policies()).rows, oldPolicies);
    const permissions = await db.raw(
      "SELECT has_function_privilege('grove_runtime','grove_admin_usage_report(date,date,uuid)','EXECUTE') AS runtime, has_function_privilege('grove_worker','grove_admin_usage_report(date,date,uuid)','EXECUTE') AS worker, has_function_privilege('grove_runtime','grove_admin_usage_rows(date,date)','EXECUTE') AS helper",
    );
    assert.deepEqual(permissions.rows[0], {
      runtime: true,
      worker: false,
      helper: false,
    });
  } finally {
    await Promise.all([db.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
