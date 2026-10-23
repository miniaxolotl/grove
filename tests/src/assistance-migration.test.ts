import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrationSource, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";

test("014→015 preserves content, seeds independent preferences once and enforces assistance RLS", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const name = `grove_assistance_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const connect = (input: string) => {
    const value = new URL(input);
    value.pathname = `/${name}`;
    return createDatabase(value.href);
  };
  const authority = createDatabase(url),
    owner = connect(url),
    runtime = connect(process.env.TEST_DATABASE_URL!);
  try {
    await authority.raw("CREATE DATABASE ??", [name]);
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () => all.filter((m) => m.name < "20261022_015"),
      },
    });
    const a = randomUUID(),
      b = randomUUID(),
      project = randomUUID(),
      note = randomUUID();
    await owner("accounts").insert([
      {
        id: a,
        clerkSubject: "assistance_upgrade",
        titlesTagsEnabled: false,
        askEnabled: false,
        notebookSummariesEnabled: false,
        noteConnectionsEnabled: false,
      },
      { id: b, clerkSubject: "assistance_other" },
    ]);
    await owner("projects").insert({
      id: project,
      accountId: a,
      name: "Travel",
      identity: "travel",
    });
    await owner("memories").insert({
      id: note,
      accountId: a,
      projectId: project,
      kind: "fact",
      content: "Retained original",
      source: "{}",
    });
    const before = await owner("memories").first();
    const [, applied] = await owner.migrate.up({
      name: "20261022_015_notebook_assistance",
    });
    assert.deepEqual(applied, ["20261022_015_notebook_assistance"]);
    assert.deepEqual(await owner("memories").first(), before);
    const account = await owner("accounts").where({ id: a }).first();
    for (const key of [
      "filingEnabled",
      "actionListsEnabled",
      "digestsEnabled",
      "cleanupEnabled",
    ])
      assert.equal(account[key], false);
    const service = new MemoryService(runtime, "assistance-upgrade");
    const principal = sessionPrincipal(a, "assistance_upgrade");
    await service.settings(principal, {
      organizeEnabled: true,
      summariesEnabled: true,
    });
    const unchanged = await owner("accounts").where({ id: a }).first();
    for (const key of [
      "filingEnabled",
      "actionListsEnabled",
      "digestsEnabled",
      "cleanupEnabled",
    ])
      assert.equal(unchanged[key], false);
    await service.settings(principal, { filingEnabled: true });
    assert.equal(
      (await owner("accounts").where({ id: a }).first()).actionListsEnabled,
      false,
    );
    await tenant(runtime, a, (trx) =>
      trx("notebook_checkpoints").insert({
        accountId: a,
        projectId: project,
        token: "0",
      }),
    );
    assert.equal((await runtime("notebook_checkpoints")).length, 0);
    assert.equal(
      (await tenant(runtime, b, (trx) => trx("notebook_checkpoints"))).length,
      0,
    );
    await assert.rejects(
      tenant(runtime, b, (trx) =>
        trx("notebook_checkpoints").insert({
          accountId: a,
          projectId: project,
          token: "1",
        }),
      ),
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
