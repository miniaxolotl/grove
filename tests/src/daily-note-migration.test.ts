import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, probeDatabase, type Knex } from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("API and worker readiness require the daily-note schema", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const owner = createDatabase(url);
  const name = `grove_daily_${randomUUID().replaceAll("-", "")}_test`;
  const target = (value: string) => {
    const uri = new URL(value);
    uri.pathname = `/${name}`;
    return createDatabase(uri.href);
  };
  await owner.raw("CREATE DATABASE ??", [name]);
  const admin = target(url);
  const roles = [
    target(process.env.TEST_DATABASE_URL!),
    target(process.env.TEST_WORKER_DATABASE_URL!),
  ];
  const probe = (db: Knex) =>
    db.transaction(async (trx) => {
      await trx.raw("SET TRANSACTION READ ONLY");
      await probeDatabase(trx);
    });
  try {
    await admin.migrate.latest({
      migrationSource: {
        getMigrations: async () =>
          migrations.filter((m) => m.name < "20261117_042"),
        getMigrationName: (m: (typeof migrations)[number]) => m.name,
        getMigration: async (m: (typeof migrations)[number]) => m,
      },
    });
    for (const db of roles)
      await assert.rejects(probe(db), /relation "daily_notes" does not exist/);
    await admin.migrate.latest();
    for (const db of roles) await probe(db);
  } finally {
    await Promise.all([admin, ...roles].map((db) => db.destroy()));
    await owner.raw("DROP DATABASE ??", [name]);
    await owner.destroy();
  }
});
