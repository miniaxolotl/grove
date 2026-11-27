import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, migrationSource } from "@lib/database";
import { MemoryService, Sharing } from "@lib/memory";

test("051 to 052 preserves existing shares and grants only scoped navigation to the runtime", async () => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  assert(new URL(url).pathname.endsWith("_test"));
  const authority = createDatabase(url);
  const name = `grove_reader_upgrade_${randomUUID().replaceAll("-", "")}_test`;
  const connect = (value: string) => {
    const target = new URL(value);
    target.pathname = `/${name}`;
    return createDatabase(target.href);
  };
  await authority.raw("CREATE DATABASE ??", [name]);
  const owner = connect(url),
    runtime = connect(process.env.TEST_DATABASE_URL!);
  try {
    const all = await migrationSource.getMigrations([]);
    await owner.migrate.latest({
      migrationSource: {
        ...migrationSource,
        getMigrations: async () => all.filter((m) => m.name < "20261127_052"),
      },
    });
    const accountId = randomUUID(),
      projectId = randomUUID(),
      memoryId = randomUUID();
    const token = `gsh_${"U".repeat(43)}`;
    const digest = createHash("sha256").update(token).digest("hex");
    await owner("accounts").insert({
      id: accountId,
      clerkSubject: `upgrade_${accountId}`,
    });
    await owner("projects").insert({
      id: projectId,
      accountId,
      name: "Retained notebook",
      identity: projectId,
    });
    await owner("memories").insert({
      id: memoryId,
      accountId,
      projectId,
      kind: "fact",
      content: "# Retained note",
      source: "{}",
    });
    await owner("public_shares").insert({
      id: randomUUID(),
      accountId,
      projectId,
      tokenDigest: digest,
      tokenCiphertext: "retained encrypted value",
    });
    const stored = await owner("public_shares");
    const before = await runtime.raw(
      "SELECT grove_public_share(?,'note',?::uuid,NULL,NULL,NULL,30) AS value",
      [digest, memoryId],
    );
    const [, applied] = await owner.migrate.latest();
    assert.deepEqual(applied, ["20261127_052_share_navigation"]);
    assert.deepEqual(await owner("public_shares"), stored);
    const after = await runtime.raw(
      "SELECT grove_public_share(?,'note',?::uuid,NULL,NULL,NULL,30) AS value",
      [digest, memoryId],
    );
    assert.deepEqual(after.rows[0].value, before.rows[0].value);
    const sharing = new Sharing(
      new MemoryService(
        runtime,
        "reader-upgrade-cursor-secret-at-least-32-characters",
      ),
      { key: "ab".repeat(32), siteUrl: "https://reader.example.test" },
    );
    const reader = await sharing.reader(token, { kind: "notes", id: memoryId });
    assert.equal(reader.navigation?.folder?.id, projectId);
    assert.equal(reader.listing?.notes[0].id, memoryId);
    const global = await owner("public_share_rates")
      .where({ bucket: "global" })
      .sum("count as hits")
      .first();
    assert.equal(
      Number(global?.hits),
      1,
      "A composite read admits globally once, outside its content transaction",
    );
    assert.equal((await runtime("projects")).length, 0);
    await assert.rejects(
      runtime.raw("SELECT grove_share_notebooks(?::uuid,?::uuid,true)", [
        accountId,
        projectId,
      ]),
      { code: "42501" },
    );
  } finally {
    await Promise.all([owner.destroy(), runtime.destroy()]);
    await authority.raw("DROP DATABASE ?? WITH (FORCE)", [name]);
    await authority.destroy();
  }
});
