import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrationSource, tenant } from "@lib/database";
import {
  organizationPreferences,
  summaryPreferences,
} from "@lib/shared/preferences";

test("AI preference upgrade preserves all legacy choices, content and tenant isolation", async () => {
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  assert(
    ownerUrl && runtimeUrl && new URL(ownerUrl).pathname.endsWith("_test"),
  );
  const name = `grove_preferences_${randomUUID().replaceAll("-", "")}_test`;
  const connection = (url: string) => {
    const value = new URL(url);
    value.pathname = `/${name}`;
    return createDatabase(value.href);
  };
  const admin = createDatabase(ownerUrl);
  const owner = connection(ownerUrl);
  const runtime = connection(runtimeUrl);
  let created = false;
  try {
    await admin.raw("CREATE DATABASE ??", [name]);
    created = true;
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          all.filter(
            (migration) => migration.name < "20261022_013_ai_preferences",
          ),
      },
    });
    const accounts = [];
    for (const organizeEnabled of [true, false])
      for (const summariesEnabled of [true, false]) {
        const account = {
          id: randomUUID(),
          clerkSubject: `preferences_${randomUUID()}`,
          organizeEnabled,
          summariesEnabled,
          captureEnabled: false,
          recallEnabled: true,
        };
        await owner("accounts").insert(account);
        accounts.push(account);
      }
    const memory = {
      id: randomUUID(),
      accountId: accounts[0].id,
      content: "Retained writing and choices.",
      kind: "fact",
      source: { agent: "website" },
    };
    await owner("memories").insert(memory);
    const before = await owner("memories").where({ id: memory.id }).first();
    const [, applied] = await owner.migrate.latest();
    assert.deepEqual(applied, ["20261022_013_ai_preferences"]);
    for (const old of accounts) {
      const current = await tenant(runtime, old.id, (trx) =>
        trx("accounts").where({ id: old.id }).first(),
      );
      for (const key of organizationPreferences)
        assert.equal(current[key], old.organizeEnabled, key);
      for (const key of [...summaryPreferences, "askEnabled"])
        assert.equal(current[key], old.summariesEnabled, key);
      assert.equal(current.captureEnabled, old.captureEnabled);
      assert.equal(current.recallEnabled, old.recallEnabled);
      assert.equal(current.organizeEnabled, old.organizeEnabled);
      assert.equal(current.summariesEnabled, old.summariesEnabled);
    }
    assert.deepEqual(
      await owner("memories").where({ id: memory.id }).first(),
      before,
    );
    assert.equal((await runtime("accounts")).length, 0);
    assert.equal(
      (await tenant(runtime, accounts[1].id, (trx) => trx("memories"))).length,
      0,
    );
    await assert.rejects(
      runtime.raw("ALTER TABLE accounts DROP COLUMN ask_enabled"),
    );
  } finally {
    await Promise.all([runtime.destroy(), owner.destroy()]);
    if (created) await admin.raw("DROP DATABASE ??", [name]);
    await admin.destroy();
  }
});
