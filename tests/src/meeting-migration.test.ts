import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("meeting upgrade preserves existing source, usage and opt-outs; new fields keep forced tenant isolation", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(url && new URL(url).pathname.endsWith("_test"));
  const name = `grove_meeting_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const connect = (input: string) => {
    const parsed = new URL(input);
    parsed.pathname = `/${name}`;
    return createDatabase(parsed.href);
  };
  const authority = createDatabase(url),
    owner = connect(url);
  const runtime = connect(process.env.TEST_DATABASE_URL!),
    worker = connect(process.env.TEST_WORKER_DATABASE_URL!);
  try {
    await authority.raw("CREATE DATABASE ??", [name]);
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          all.filter((m) => m.name <= "20261025_028_action_usage"),
      },
    });
    const a = randomUUID(),
      b = randomUUID(),
      note = randomUUID();
    await owner("accounts").insert([
      {
        id: a,
        clerkSubject: "meeting_upgrade_a",
        askEnabled: false,
        digestsEnabled: false,
      },
      { id: b, clerkSubject: "meeting_upgrade_b" },
    ]);
    await owner("memories").insert({
      id: note,
      accountId: a,
      content: "Keep authored notes",
      kind: "fact",
      source: "{}",
    });
    await owner("inference_usage").insert({
      accountId: a,
      day: "2026-10-25",
      role: "generation",
      requests: 7,
    });
    const before = await owner("memories").first();
    const usage = await owner("inference_usage").first();
    const scheduler = await owner.raw(
      "SELECT pg_get_functiondef('grove_schedule_cleanup()'::regprocedure) AS body",
    );
    const [, applied] = await owner.migrate.latest();
    assert(
      applied.some((name: string) => name.endsWith("_meeting_preparation")),
    );
    assert.deepEqual(await owner("memories").first(), before);
    assert.deepEqual(await owner("inference_usage").first(), usage);
    assert.deepEqual(
      await owner.raw(
        "SELECT pg_get_functiondef('grove_schedule_cleanup()'::regprocedure) AS body",
      ),
      scheduler,
    );
    const account = await owner("accounts").where({ id: a }).first();
    assert.equal(account.askEnabled, false);
    assert.equal(account.digestsEnabled, false);
    assert.equal(account.meetingPreparationEnabled, false);
    const request = {
      accountId: a,
      id: randomUUID(),
      kind: "meeting",
      input: "{}",
      fingerprint: "upgrade",
      profile: "fixture",
    };
    await tenant(runtime, a, (trx) =>
      trx("assistance_requests").insert(request),
    );
    for (const database of [runtime, worker]) {
      assert.deepEqual(await database("assistance_requests"), []);
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
    const { rows } = await owner.raw(
      "SELECT relforcerowsecurity FROM pg_class WHERE oid='assistance_requests'::regclass",
    );
    assert.equal(rows[0].relforcerowsecurity, true);
    await assert.rejects(
      runtime.raw("SELECT grove_schedule_meeting_cleanup()"),
    );
    assert.equal(
      typeof (
        await worker.raw("SELECT grove_schedule_meeting_cleanup() AS scheduled")
      ).rows[0].scheduled,
      "number",
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy(), worker.destroy()]);
    await authority.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
