import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant, type Knex } from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("context migration follows the merged search migration without reusing its slot", () => {
  assert.deepEqual(
    migrations.slice(-3).map((migration) => migration.name),
    [
      "20261025_028_action_usage",
      "20261025_029_search_quality",
      "20261025_030_conversation_context",
    ],
  );
});

test("context upgrade preserves old conversation rows and tenant isolation", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_context_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const parsed = new URL(uri);
    parsed.pathname = `/${name}`;
    return parsed.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url));
  const db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const before = migrations.filter((m) => m.name < "20261025_030");
    const migrationSource: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () => before,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await admin.migrate.latest({ migrationSource });
    const accountId = randomUUID(),
      id = randomUUID(),
      turnId = randomUUID();
    await admin("accounts").insert({
      id: accountId,
      clerkSubject: `context_${accountId}`,
    });
    await tenant(db, accountId, async (trx) => {
      await trx("conversations").insert({ id, accountId, scope: "{}" });
      await trx("conversation_turns").insert({
        id: turnId,
        accountId,
        conversationId: id,
        position: 1,
        question: "Old question",
        fingerprint: "retained",
        status: "failed",
      });
    });
    const rows = await admin("conversation_turns");
    await admin.migrate.latest();
    assert.deepEqual(
      await admin("conversation_turns").select(Object.keys(rows[0])),
      rows,
    );
    assert.equal((await admin("conversation_turns").first()).context, null);
    const context = { notes: [randomUUID()], notebooks: [], only: true };
    await tenant(db, accountId, (trx) =>
      trx("conversation_turns")
        .where({ id: turnId })
        .update({ context: JSON.stringify(context) }),
    );
    assert.deepEqual(
      (await tenant(db, accountId, (trx) => trx("conversation_turns").first()))
        .context,
      context,
    );
    assert.deepEqual(
      await tenant(db, randomUUID(), (trx) => trx("conversation_turns")),
      [],
    );
  } finally {
    await Promise.all([db.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
