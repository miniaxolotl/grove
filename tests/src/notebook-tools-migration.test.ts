import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("033 preserves legacy meeting data, usage and opt-outs and adds only default-off tenant-bound tools", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const name = `grove_tools_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const connect = (input: string) => {
    const parsed = new URL(input);
    parsed.pathname = `/${name}`;
    return createDatabase(parsed.href);
  };
  const authority = createDatabase(url),
    owner = connect(url),
    runtime = connect(process.env.TEST_DATABASE_URL!),
    worker = connect(process.env.TEST_WORKER_DATABASE_URL!);
  try {
    await authority.raw("CREATE DATABASE ??", [name]);
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          all.filter((m) => m.name <= "20261025_031_meeting_preparation"),
      },
    });
    const a = randomUUID(),
      b = randomUUID(),
      id = randomUUID();
    await owner("accounts").insert([
      {
        id: a,
        clerkSubject: "tools_upgrade_a",
        askEnabled: false,
        meetingPreparationEnabled: true,
      },
      { id: b, clerkSubject: "tools_upgrade_b" },
    ]);
    await owner("memories").insert({
      accountId: a,
      id: randomUUID(),
      content: "Original note",
      kind: "fact",
      source: "{}",
    });
    await owner("inference_usage").insert({
      accountId: a,
      day: "2026-10-25",
      role: "generation",
      requests: 9,
    });
    await owner("assistance_requests").insert({
      accountId: a,
      id,
      kind: "meeting",
      input: JSON.stringify({ agenda: "Retain this legacy brief" }),
      fingerprint: "legacy",
      profile: "fixture",
    });
    const before = await owner("assistance_requests").first(),
      notes = await owner("memories"),
      usage = await owner("inference_usage");
    const scheduler = await owner.raw(
      "SELECT pg_get_functiondef('grove_schedule_meeting_cleanup()'::regprocedure) AS body",
    );
    const [, applied] = await owner.migrate.latest();
    assert(applied.includes("20261025_033_notebook_tools"));
    assert.deepEqual(await owner("assistance_requests").first(), before);
    assert.deepEqual(await owner("memories"), notes);
    assert.deepEqual(await owner("inference_usage"), usage);
    assert.deepEqual(
      await owner.raw(
        "SELECT pg_get_functiondef('grove_schedule_meeting_cleanup()'::regprocedure) AS body",
      ),
      scheduler,
    );
    const account = await owner("accounts").where({ id: a }).first();
    assert.equal(account.askEnabled, false);
    assert.equal(account.meetingPreparationEnabled, true);
    for (const key of [
      "preparationEnabled",
      "weeklyReviewEnabled",
      "studyModeEnabled",
      "knowledgeGapsEnabled",
      "similarProblemsEnabled",
    ])
      assert.equal(account[key], false);
    for (const kind of [
      "preparation",
      "weekly_review",
      "study",
      "knowledge_gaps",
      "similar_problems",
    ]) {
      const request = {
        accountId: a,
        fingerprint: "new-tool",
        profile: "fixture",
        id: randomUUID(),
        kind,
        input: JSON.stringify({ scope: { kind: "library" } }),
      };
      await tenant(runtime, a, (trx) =>
        trx("assistance_requests").insert(request),
      );
      for (const database of [runtime, worker]) {
        assert.deepEqual(
          await tenant(database, b, (trx) => trx("assistance_requests")),
          [],
        );
        await assert.rejects(
          tenant(database, b, (trx) =>
            trx("assistance_requests").insert({ ...request, id: randomUUID() }),
          ),
        );
      }
    }
    await assert.rejects(runtime.raw("SELECT grove_schedule_tool_cleanup()"));
    assert.equal(
      typeof (
        await worker.raw("SELECT grove_schedule_tool_cleanup() AS scheduled")
      ).rows[0].scheduled,
      "number",
    );
    assert.equal(
      (
        await owner.raw(
          "SELECT relforcerowsecurity FROM pg_class WHERE oid='assistance_requests'::regclass",
        )
      ).rows[0].relforcerowsecurity,
      true,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy(), worker.destroy()]);
    await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
