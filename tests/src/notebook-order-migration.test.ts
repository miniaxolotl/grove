import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  probeDatabase,
  tenant,
  type Knex,
} from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("notebook order upgrade preserves retained columns and backfills stable sibling positions", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_order_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (uri: string) => {
    const u = new URL(uri);
    u.pathname = `/${name}`;
    return u.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target(url));
  const db = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const before = migrations.filter(
      (m) => m.name < "20261025_032_notebook_order",
    );
    const migrationSource: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () => before,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await admin.migrate.latest({ migrationSource });
    await assert.rejects(
      probeDatabase(db),
      /position|notebook_order_version/,
      "new runtime must reject a schema without notebook order",
    );
    const accountId = randomUUID(),
      other = randomUUID();
    await admin("accounts").insert([
      { id: accountId, clerkSubject: accountId },
      { id: other, clerkSubject: other },
    ]);
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    await admin("projects").insert([
      { id: b, accountId, name: "B", identity: b },
      { id: a, accountId, name: "A", identity: a },
      { id: c, accountId, name: "Child", identity: c, parentId: a },
    ]);
    const retained = await admin("projects").orderBy("id");
    const accounts = await admin("accounts").orderBy("id");
    await admin.migrate.latest();
    const upgraded = await admin("projects").orderBy("id");
    assert.deepEqual(
      upgraded.map(({ position: _position, ...row }) => row),
      retained,
    );
    const currentAccounts = await admin("accounts").orderBy("id");
    assert.deepEqual(
      currentAccounts.map(
        ({ exportVersion: _version, notebookOrderVersion: _order, ...row }) =>
          row,
      ),
      accounts.map(({ exportVersion: _version, ...row }) => row),
    );
    assert(currentAccounts.every((a) => a.notebookOrderVersion === "0"));
    assert.equal(
      Number(currentAccounts.find((a) => a.id === accountId)!.exportVersion),
      Number(accounts.find((a) => a.id === accountId)!.exportVersion) + 3,
      "existing export invalidation tracks rank backfill",
    );
    assert.equal(upgraded.find((p) => p.id === a)!.position, 1);
    assert.equal(upgraded.find((p) => p.id === b)!.position, 2);
    assert.equal(upgraded.find((p) => p.id === c)!.position, 1);
    const created = await tenant(db, accountId, (trx) =>
      trx("projects")
        .insert({ accountId, name: "AA", identity: randomUUID() })
        .returning("*"),
    );
    assert.equal(
      created[0].position,
      3,
      "legacy writers append without new fields",
    );
    const moved = await tenant(db, accountId, (trx) =>
      trx("projects").where({ id: b }).update({ parentId: a }).returning("*"),
    );
    assert.equal(
      moved[0].position,
      2,
      "legacy reparenting appends in destination",
    );
    assert.deepEqual(await tenant(db, other, (trx) => trx("projects")), []);
    await assert.rejects(
      tenant(db, other, (trx) =>
        trx("projects").insert({
          accountId,
          name: "Foreign",
          identity: randomUUID(),
        }),
      ),
      /row-level security/,
    );
    assert.deepEqual(await db("projects"), []);
  } finally {
    await Promise.all([db.destroy(), admin.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
