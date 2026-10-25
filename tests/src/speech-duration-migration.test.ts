import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("duration upgrade retains character counters, conservatively accounts old attempts and isolates both runtime roles", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source);
  const name = `grove_duration_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const target = (input: string) => {
    const url = new URL(input);
    url.pathname = `/${name}`;
    return url.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source));
  const api = createDatabase(target(process.env.TEST_DATABASE_URL!));
  const worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261025_026"),
      },
    });
    const [a, b] = await owner("accounts")
      .insert([{ clerkSubject: randomUUID() }, { clerkSubject: randomUUID() }])
      .returning("*");
    await owner("speech_usage").insert({
      accountId: a.id,
      kind: "speech_synthesize",
      requests: 2,
      units: 33,
    });
    await owner.migrate.latest();
    assert.equal(
      await owner.schema.hasColumn("speech_usage", "duration_ms"),
      true,
      "audio duration must not overwrite character counters",
    );
    const initial = await tenant(api, a.id, (trx) =>
      trx("speech_usage").first(),
    );
    assert.equal(initial.units, 33);
    assert.equal(initial.requests, 2);
    assert.equal(Number(initial.durationMs), 2 * 3145800);
    for (const db of [api, worker]) {
      assert.deepEqual(
        await tenant(db, b.id, (trx) => trx("speech_usage")),
        [],
      );
      await assert.rejects(
        tenant(db, b.id, (trx) =>
          trx("speech_usage").insert({
            accountId: a.id,
            kind: "speech_synthesize",
            units: 1,
          }),
        ),
        /row-level security/,
      );
    }
    // An old binary's character-only increment must not bypass the new duration cap.
    await tenant(worker, a.id, (trx) =>
      trx("speech_usage")
        .where({ kind: "speech_synthesize" })
        .increment({ requests: 1, units: 7 }),
    );
    assert.equal(
      Number(
        (await tenant(api, a.id, (trx) => trx("speech_usage").first()))
          .durationMs,
      ),
      3 * 3145800,
    );
    await tenant(worker, a.id, (trx) =>
      trx("speech_usage")
        .where({ kind: "speech_synthesize" })
        .update({ durationMs: 400 }),
    );
    assert.equal(
      Number(
        (await tenant(api, a.id, (trx) => trx("speech_usage").first()))
          .durationMs,
      ),
      400,
    );
  } finally {
    await Promise.all([owner.destroy(), api.destroy(), worker.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
