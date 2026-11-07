import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createDatabase,
  migrationSource,
  probeDatabase,
  tenant,
} from "@lib/database";

test("native sharing upgrade leaves existing grants off and preserves retained links and RLS", async () => {
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL!,
    runtimeUrl = process.env.TEST_DATABASE_URL!;
  assert.ok(
    ownerUrl && runtimeUrl && new URL(ownerUrl).pathname.endsWith("_test"),
  );
  const name = `grove_native_share_${randomUUID().replaceAll("-", "")}_test`;
  const connection = (url: string) => {
    const value = new URL(url);
    value.pathname = `/${name}`;
    return createDatabase(value.href);
  };
  const admin = createDatabase(ownerUrl),
    owner = connection(ownerUrl),
    runtime = connection(runtimeUrl);
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
            (migration) => migration.name < "20261106_039_native_note_sharing",
          ),
      },
    });
    const accountId = randomUUID(),
      id = randomUUID(),
      noteId = randomUUID(),
      shareId = randomUUID();
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: `native-share-upgrade-${accountId}`,
    });
    await owner("connections").insert({
      id,
      accountId,
      name: "Existing browser",
      clientId: randomUUID(),
      capabilities: ["memory:read"],
      personal: true,
    });
    await owner("memories").insert({
      id: noteId,
      accountId,
      content: "Existing shared note",
      kind: "fact",
      source: { agent: "api" },
    });
    await owner("public_shares").insert({
      id: shareId,
      accountId,
      memoryId: noteId,
      version: 3,
      tokenDigest: "ab".repeat(32),
      tokenCiphertext: "existing-encrypted-capability",
    });
    const before = await owner("public_shares").where({ id: shareId }).first();
    await assert.rejects(probeDatabase(runtime), /sharing_enabled/i);
    const [, applied] = await owner.migrate.latest();
    assert.deepEqual(applied, [
      "20261106_039_native_note_sharing",
      "20261107_040_writing_allowance",
    ]);
    assert.equal(
      (await owner("connections").where({ id }).first()).sharingEnabled,
      false,
    );
    assert.deepEqual(
      await owner("public_shares").where({ id: shareId }).first(),
      before,
    );
    assert.equal((await runtime("connections")).length, 0);
    assert.equal((await runtime("public_shares")).length, 0);
    await probeDatabase(runtime);
    assert.equal(
      (
        await tenant(runtime, accountId, (trx) =>
          trx("connections").where({ id }).first(),
        )
      ).sharingEnabled,
      false,
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    if (created) await admin.raw("DROP DATABASE ??", [name]);
    await admin.destroy();
  }
});
