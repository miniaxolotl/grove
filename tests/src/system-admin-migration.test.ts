import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("024→025 preserves all retained state, creates no admins and removes inherited write privileges", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_admin_upgrade_${randomUUID().replaceAll("-", "")}_test`;
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
          migrations.filter((migration) => migration.name < "20261025_025"),
      },
    });
    const accountId = randomUUID();
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: "user_upgrade",
    });
    await owner("memories").insert({
      id: randomUUID(),
      accountId,
      content: "Retain this private note",
      kind: "fact",
      source: { agent: "website" },
    });
    await owner("billing_customers").insert({
      accountId,
      customerId: "cus_upgrade",
    });
    const tables = (
      await owner.raw(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'knex_%' ORDER BY tablename",
      )
    ).rows.map((row: { tablename: string }) => row.tablename);
    const fingerprint = async () => {
      const result: unknown[] = [];
      for (const table of tables)
        result.push([
          table,
          (
            await owner.raw(
              "SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text),'')) AS fingerprint FROM ?? t",
              [table],
            )
          ).rows[0].fingerprint,
        ]);
      return result;
    };
    const before = await fingerprint();
    await owner.raw(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO grove_runtime,grove_worker",
    );
    await owner.raw(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO grove_runtime,grove_worker",
    );
    await owner.migrate.up({ name: "20261025_025_system_administration" });
    assert.deepEqual(await fingerprint(), before);
    assert.equal((await owner("account_administration")).length, 0);
    assert.equal((await owner("system_admin_audit")).length, 0);
    const privileges = (
      await runtime.raw(
        "SELECT has_table_privilege(current_user,'account_administration','UPDATE') AS write, has_table_privilege(current_user,'system_admin_audit','SELECT') AS audit",
      )
    ).rows[0];
    assert.equal(
      privileges.write,
      false,
      "inherited defaults cannot permit self-promotion",
    );
    assert.equal(privileges.audit, false);
    assert.equal(
      (
        await runtime.raw(
          "SELECT has_function_privilege(current_user,'grove_bootstrap_system_admin(text,text)','EXECUTE') AS bootstrap",
        )
      ).rows[0].bootstrap,
      false,
    );
    assert.equal(
      (await tenant(runtime, accountId, (trx) => trx("account_administration")))
        .length,
      0,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
