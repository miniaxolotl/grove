import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";
import { rememberSchema, type Principal } from "@lib/shared/contracts";

const url = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
assert(
  url && ownerUrl && new URL(ownerUrl).pathname.endsWith("_test"),
  "Use disposable test databases",
);
const db = createDatabase(url);
const admin = createDatabase(ownerUrl);
const service = new MemoryService(
  db,
  "sharing-test-cursor-secret-at-least-32-characters",
);
let alice: Principal;
let bob: Principal;
before(async () => {
  const account = async () => {
    const subject = `user_sharing_${randomUUID()}`;
    const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
    return sessionPrincipal(rows[0].id, subject);
  };
  alice = await account();
  bob = await account();
});
after(async () => {
  await Promise.all([db.destroy(), admin.destroy()]);
});

const save = (
  principal: Principal,
  content = "# Shared note",
  projectId: string | null = null,
) =>
  service.remember(
    principal,
    rememberSchema.parse({ operationId: randomUUID(), content, projectId }),
  );

test("share storage enforces tenant isolation, same-owner targets and explicit target shape", async () => {
  const mine = await save(alice);
  const foreign = await save(bob);
  const row = {
    id: randomUUID(),
    accountId: alice.accountId,
    memoryId: mine.id,
    tokenDigest: "a".repeat(64),
    tokenCiphertext: "encrypted-fixture",
  };
  await tenant(db, alice.accountId, (trx) => trx("public_shares").insert(row));
  assert.equal((await db("public_shares")).length, 0);
  assert.equal(
    (
      await tenant(db, bob.accountId, (trx) =>
        trx("public_shares").where({ id: row.id }),
      )
    ).length,
    0,
  );
  await assert.rejects(
    tenant(db, alice.accountId, (trx) =>
      trx("public_shares").insert({
        ...row,
        id: randomUUID(),
        memoryId: foreign.id,
        tokenDigest: "b".repeat(64),
      }),
    ),
    /foreign key/,
  );
  await assert.rejects(
    tenant(db, bob.accountId, (trx) =>
      trx("public_shares").insert({
        ...row,
        id: randomUUID(),
        tokenDigest: "b".repeat(64),
      }),
    ),
    /row-level security/,
  );
  await assert.rejects(
    tenant(db, alice.accountId, (trx) =>
      trx("public_shares").insert({
        ...row,
        id: randomUUID(),
        memoryId: null,
        tokenDigest: "b".repeat(64),
      }),
    ),
    /check constraint/,
  );
  await assert.rejects(
    tenant(db, alice.accountId, (trx) =>
      trx("public_shares")
        .where({ id: row.id })
        .update({ includeDescendants: true }),
    ),
    /check constraint/,
  );
  await assert.rejects(
    db("public_share_rates").select("*"),
    /permission denied/,
  );
  const { rows } = await admin.raw(
    "SELECT has_function_privilege('grove_worker', 'grove_public_share(text,text,uuid,uuid,uuid,integer,integer)', 'EXECUTE') AS permitted",
  );
  assert.equal(rows[0].permitted, false);
  await tenant(db, alice.accountId, (trx) =>
    trx("memories").where({ id: mine.id }).delete(),
  );
  assert.equal(
    (
      await tenant(db, alice.accountId, (trx) =>
        trx("public_shares").where({ id: row.id }),
      )
    ).length,
    0,
  );
});
