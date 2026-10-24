import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, migrationSource } from "@lib/database";
import { MemoryService } from "@lib/memory";
import { preferencesFor } from "@lib/shared/preferences";
import { Authentication } from "../../packages/api/src/auth.ts";

test("speech defaults enable read aloud but leave transcription off", () => {
  assert.equal(preferencesFor({}).transcriptionEnabled, false);
  assert.equal(preferencesFor({}).readAloudEnabled, true);
});

test("speech defaults preserve saved choices and unrelated legacy preferences", () => {
  for (const transcriptionEnabled of [false, true])
    for (const readAloudEnabled of [false, true]) {
      const preferences = preferencesFor({
        transcriptionEnabled,
        readAloudEnabled,
        organizeEnabled: false,
        summariesEnabled: false,
      });
      assert.equal(preferences.transcriptionEnabled, transcriptionEnabled);
      assert.equal(preferences.readAloudEnabled, readAloudEnabled);
      assert.equal(preferences.askEnabled, false);
      assert.equal(preferences.titlesTagsEnabled, false);
    }
});

test("020→021 changes future speech defaults without changing existing choices or queuing speech", async () => {
  const source = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(source && new URL(source).pathname.endsWith("_test"));
  const authority = createDatabase(source);
  const name = `grove_speech_defaults_${randomUUID().replaceAll("-", "")}_test`;
  const target = (input: string) => {
    const url = new URL(input);
    url.pathname = `/${name}`;
    return url.href;
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = createDatabase(target(source));
  const runtime = createDatabase(target(process.env.TEST_DATABASE_URL!));
  try {
    const migrations = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          migrations.filter((entry) => entry.name < "20261023_021"),
      },
    });
    for (const transcriptionEnabled of [false, true])
      for (const readAloudEnabled of [false, true])
        await owner("accounts").insert({
          clerkSubject: `saved_${randomUUID()}`,
          transcriptionEnabled,
          readAloudEnabled,
          transcriptionVersion: 3,
          readAloudVersion: 4,
          askEnabled: false,
        });
    const before = await owner("accounts").orderBy("id");
    const [, applied] = await owner.migrate.up({
      name: "20261023_021_speech_defaults",
    });
    assert.deepEqual(applied, ["20261023_021_speech_defaults"]);
    assert.deepEqual(await owner("accounts").orderBy("id"), before);

    const [fresh] = await owner("accounts")
      .insert({ clerkSubject: `default_${randomUUID()}` })
      .returning("*");
    assert.equal(fresh.transcriptionEnabled, false);
    assert.equal(fresh.readAloudEnabled, true);
    // Historical assertions above stop at 021. Current service code requires the
    // current schema, including the separately migrated voice preference.
    await owner.migrate.latest();

    const auth = new Authentication(runtime, {
      async verify() {
        return {
          subject: `new_${randomUUID()}`,
          type: "session",
          sessionId: "speech-defaults-session",
        };
      },
    });
    const principal = await auth.principal(
      new Request("http://localhost", {
        headers: { authorization: "Bearer fixture" },
      }),
    );
    const service = new MemoryService(
      runtime,
      "speech-defaults-test-cursor-secret-32-characters",
    );
    const account = await service.me(principal);
    assert.equal(account.transcriptionEnabled, false);
    assert.equal(account.readAloudEnabled, true);
    assert.equal((await owner("background_tasks")).length, 0);
    const created = await owner("accounts")
      .where({ id: principal.accountId })
      .first();
    assert.equal(created.transcriptionVersion, 0);
    assert.equal(created.readAloudVersion, 0);
    await service.settings(principal, { readAloudEnabled: false });
    assert.equal((await service.me(principal)).readAloudEnabled, false);
    assert.equal((await owner("background_tasks")).length, 0);
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
