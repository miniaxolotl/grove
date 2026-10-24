import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource, tenant } from "@lib/database";

test("021→022 adds Reed without rewriting consent, content or transcription configuration", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source),
    name = `grove_voices_${randomUUID().replaceAll("-", "")}_test`;
  const target = (input: string) => {
    const url = new URL(input);
    url.pathname = `/${name}`;
    return url.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source)),
    runtime = createDatabase(target(process.env.TEST_DATABASE_URL!)),
    worker = createDatabase(target(process.env.TEST_WORKER_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261024_022"),
      },
    });
    const accounts = [true, false].map((enabled) => ({
      id: randomUUID(),
      clerkSubject: randomUUID(),
      transcriptionEnabled: enabled,
      readAloudEnabled: enabled,
      readAloudVersion: 4,
      transcriptionVersion: 2,
    }));
    await owner("accounts").insert(accounts);
    await owner("speech_configuration").update({
      transcription: "retained",
      synthesis: "legacy",
    });
    const before = await owner("accounts").orderBy("id");
    const next = migrations.find(
      (entry) => entry.name === "20261024_022_speech_voices",
    );
    assert(next, "the forward voice migration must be registered");
    await owner.migrate.up({ name: next.name });
    const after = await owner("accounts").orderBy("id");
    assert.deepEqual(
      after.map(({ readAloudVoiceId, ...row }) => {
        assert.equal(readAloudVoiceId, "reed");
        return row;
      }),
      before,
    );
    const [fresh] = await owner("accounts")
      .insert({ clerkSubject: randomUUID() })
      .returning("*");
    assert.equal(fresh.readAloudVoiceId, "reed");
    assert.equal(fresh.readAloudEnabled, true);
    assert.equal(fresh.transcriptionEnabled, false);
    const configuration = await owner("speech_configuration").first();
    assert.equal(configuration.transcription, "retained");
    assert.equal(configuration.synthesis, "legacy");
    assert.deepEqual(configuration.synthesisProfiles, {});
    await tenant(runtime, fresh.id, (trx) =>
      trx("accounts")
        .where({ id: fresh.id })
        .update({ readAloudVoiceId: "willow" }),
    );
    assert.equal(
      (await owner("accounts").where({ id: fresh.id }).first())
        .readAloudVersion,
      0,
    );
    assert.equal(
      await tenant(runtime, accounts[0].id, (trx) =>
        trx("accounts")
          .where({ id: fresh.id })
          .update({ readAloudVoiceId: "cedar" }),
      ),
      0,
    );
    await assert.rejects(
      tenant(runtime, fresh.id, (trx) =>
        trx("accounts")
          .where({ id: fresh.id })
          .update({ readAloudVoiceId: "provider-id" }),
      ),
      /check constraint/,
    );
    await assert.rejects(
      worker("speech_configuration").update({ synthesisProfiles: "{}" }),
      /permission denied/,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy(), worker.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
