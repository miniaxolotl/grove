import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createDatabase,
  tenant,
  probeDatabase,
  type Knex,
} from "@lib/database";
import { migrations } from "../../../lib/database/src/migrations.ts";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { listSchema } from "@lib/shared/contracts";

test("populated note-order upgrade preserves revisions and forces real-role tenant isolation", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_note_order_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const value = new URL(uri);
    value.pathname = `/${name}`;
    return value.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url));
  const api = createDatabase(target(process.env.TEST_DATABASE_URL!));
  const worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    const source: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () =>
        migrations.filter((migration) => migration.name < "20261127_051"),
      getMigrationName: (migration) => migration.name,
      getMigration: async (migration) => migration,
    };
    await admin.migrate.latest({ migrationSource: source });
    const accountId = randomUUID(),
      other = randomUUID(),
      id = randomUUID();
    await admin("accounts").insert([
      { id: accountId, clerkSubject: `upgrade_${accountId}` },
      { id: other, clerkSubject: `upgrade_${other}` },
    ]);
    await tenant(api, accountId, async (trx) => {
      await trx("memories").insert({
        id,
        accountId,
        content: "# Legacy note\n\nExact source.",
        kind: "fact",
        source: { agent: "api" },
      });
      await trx("memory_revisions").insert({
        accountId,
        memoryId: id,
        version: 1,
        content: "# Legacy note\n\nExact source.",
        source: { agent: "api" },
      });
    });
    const notes = await admin("memories"),
      history = await admin("memory_revisions");
    await assert.rejects(probeDatabase(api), /note_order|does not exist/);
    await admin.migrate.latest();
    assert.deepEqual(await admin("memories"), notes);
    assert.deepEqual(await admin("memory_revisions"), history);
    const service = new MemoryService(api, "order-upgrade-secret");
    const principal = sessionPrincipal(accountId, `upgrade_${accountId}`);
    assert.equal(
      (await service.list(principal, listSchema.parse({ sort: "custom" })))
        .items[0].id,
      id,
    );
    await tenant(api, accountId, (trx) =>
      trx("note_order_positions").insert({
        accountId,
        memoryId: id,
        scope: "all",
        rank: "1.5",
      }),
    );
    for (const runtime of [api, worker]) {
      await probeDatabase(runtime);
      assert.equal((await runtime("note_order_positions")).length, 0);
      assert.equal(
        (await tenant(runtime, other, (trx) => trx("note_order_positions")))
          .length,
        0,
      );
      await assert.rejects(
        tenant(runtime, other, (trx) =>
          trx("note_order_positions").insert({
            accountId,
            memoryId: id,
            scope: "unfiled",
            rank: "1",
          }),
        ),
        /row-level security/,
      );
      assert.equal(
        (await tenant(runtime, accountId, (trx) => trx("note_order_positions")))
          .length,
        1,
      );
    }
  } finally {
    await Promise.all([api.destroy(), worker.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});

test("bulk ordinary note creation keeps append work bounded at account scale", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_note_append_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const value = new URL(uri);
    value.pathname = `/${name}`;
    return value.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url));
  const api = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    await admin.migrate.latest();
    for (const runtime of [admin, api]) {
      const accountId = randomUUID();
      await admin("accounts").insert({
        id: accountId,
        clerkSubject: `bulk_${accountId}`,
      });
      // Short committed batches avoid an unrelated pre-051 quadratic chain of
      // account-row updates in one giant INSERT, while reaching the real cap.
      for (let start = 1; start <= 10000; start += 100) {
        await tenant(runtime, accountId, async (trx) => {
          await trx.raw("SET LOCAL statement_timeout = '2s'");
          await trx.raw(
            `INSERT INTO memories(account_id, content, kind, source)
            SELECT ?::uuid, 'Bounded append fixture ' || n, 'fact', '{}'::jsonb
            FROM generate_series(?::integer, ?::integer) n`,
            [accountId, start, start + 99],
          );
        });
      }
      await tenant(runtime, accountId, async (trx) => {
        assert.equal(
          Number((await trx("memories").count("* as count").first())!.count),
          10000,
        );
      });
    }
  } finally {
    await Promise.all([api.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
