import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, probeDatabase, type Knex } from "@lib/database";
import { migrations } from "../../lib/database/src/migrations.ts";

test("search upgrade preserves authored rows and vectors and installs invoker-only prerequisites", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_search_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = new URL(url);
  target.pathname = `/${name}`;
  await authority.raw("CREATE DATABASE ??", [name]);
  const admin = createDatabase(target.href);
  const runtimeTarget = new URL(process.env.TEST_DATABASE_URL!);
  runtimeTarget.pathname = `/${name}`;
  const runtime = createDatabase(runtimeTarget.href);
  try {
    const before = migrations.filter(
      (m) => !m.name.endsWith("_search_quality"),
    );
    const migrationSource: Knex.MigrationSource<(typeof migrations)[number]> = {
      getMigrations: async () => before,
      getMigrationName: (m) => m.name,
      getMigration: async (m) => m,
    };
    await admin.migrate.latest({ migrationSource });
    const accountId = randomUUID();
    await admin("accounts").insert({
      id: accountId,
      clerkSubject: `search_upgrade_${accountId}`,
    });
    await admin("memories").insert({
      accountId,
      content: "# alpha\nbeta",
      kind: "fact",
      source: { agent: "api" },
    });
    const notes = await admin("memories").select("*");
    await assert.rejects(probeDatabase(runtime), /search-quality migration/);
    await admin.migrate.latest();
    await probeDatabase(runtime);
    await assert.rejects(
      runtime.raw("CREATE EXTENSION hstore"),
      /permission denied/,
    );
    await assert.rejects(
      runtime.raw("CREATE TABLE public.search_runtime_denied(id integer)"),
      /permission denied/,
    );
    assert.deepEqual(await admin("memories").select("*"), notes);
    assert.equal(
      (
        await admin.raw(
          "SELECT extname FROM pg_extension WHERE extname='pg_trgm'",
        )
      ).rows.length,
      1,
    );
    const functions = await admin.raw(
      "SELECT prosecdef FROM pg_proc WHERE proname='grove_search_title'",
    );
    assert.equal(functions.rows.length, 1);
    assert.equal(functions.rows[0].prosecdef, false);
    for (const [content, title, expected] of [
      ["\n  # Garden\r\nBody", "Ignored title", "Garden"],
      ["Ordinary opening\nBody", "Visible title", "Visible title"],
      ["Plain note", null, "Plain note"],
    ]) {
      const result = await admin.raw(
        "SELECT grove_search_title(?::text,?::text) AS title",
        [content, title],
      );
      assert.equal(result.rows[0].title, expected);
    }
  } finally {
    await Promise.all([admin.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ??", [name]);
    await authority.destroy();
  }
});
