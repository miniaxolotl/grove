import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, migrationSource } from "@lib/database";

test("upgrading existing shares preserves capabilities and enables expiry without weakening RLS", async () => {
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  assert(
    ownerUrl && runtimeUrl && new URL(ownerUrl).pathname.endsWith("_test"),
  );
  const name = `grove_share_upgrade_${randomUUID().replaceAll("-", "")}_test`;
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
            (migration) => migration.name < "20261022_012_share_expiration",
          ),
      },
    });
    const account = randomUUID(),
      project = randomUUID(),
      share = randomUUID();
    const digest = createHash("sha256")
      .update(`gsh_${"a".repeat(43)}`)
      .digest("hex");
    await owner("accounts").insert({
      id: account,
      clerkSubject: `user_upgrade_${account}`,
    });
    await owner("projects").insert({
      id: project,
      accountId: account,
      name: "Existing notebook",
      identity: project,
    });
    await owner("public_shares").insert({
      id: share,
      accountId: account,
      projectId: project,
      tokenDigest: digest,
      tokenCiphertext: "existing-encrypted-copy",
      version: 3,
    });
    const before = await owner("public_shares").where({ id: share }).first();
    const read = async () =>
      (
        await runtime.raw(
          "SELECT grove_public_share(?, 'root', NULL, NULL, NULL, NULL, 30) AS value",
          [digest],
        )
      ).rows[0].value;
    assert.equal((await read()).root.name, "Existing notebook");
    const [, applied] = await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () =>
          all.filter(
            (migration) => migration.name <= "20261022_012_share_expiration",
          ),
      },
    });
    assert.deepEqual(applied, ["20261022_012_share_expiration"]);
    const after = await owner("public_shares").where({ id: share }).first();
    const { duration, expiresAt, ...retained } = after;
    assert.equal(duration, null);
    assert.equal(expiresAt, null);
    assert.deepEqual(retained, before);
    assert.equal((await read()).root.name, "Existing notebook");
    assert.equal((await runtime("public_shares")).length, 0);
    await assert.rejects(
      owner("public_shares").where({ id: share }).update({ duration: "1h" }),
      /check constraint/,
    );
    await owner("public_shares")
      .where({ id: share })
      .update({ duration: "1h", expiresAt: owner.raw("clock_timestamp()") });
    assert.equal(await read(), null);
  } finally {
    await Promise.all([runtime.destroy(), owner.destroy()]);
    if (created) await admin.raw("DROP DATABASE ??", [name]);
    await admin.destroy();
  }
});
