import assert from "node:assert/strict";
import test from "node:test";
import { verifyOwnerDatabase } from "./window-db.mjs";

const identity = {
  database: "grove",
  role: "grove_owner",
  server: "170012",
  mismatch: "error",
  ssl: false,
  superuser: false,
};
function database({ stream, row = identity, queryError } = {}) {
  const calls = [];
  const connection = {
    connection: { stream },
    query: async (statement) => {
      calls.push({ query: statement });
      if (queryError) throw queryError;
      return { rows: [row] };
    },
  };
  return {
    calls,
    raw: async () => {
      calls.push("unverified-query");
      return { rows: [row] };
    },
    client: {
      acquireConnection: async () => {
        calls.push("acquire");
        return connection;
      },
      releaseConnection: async (released) => {
        assert.equal(released, connection);
        calls.push("release");
      },
    },
  };
}
test("owner accepts verified client TLS when a terminating proxy reports backend SSL false", async () => {
  const db = database({ stream: { encrypted: true, authorized: true } });
  await verifyOwnerDatabase(db);
  assert.equal(db.calls[0], "acquire");
  assert.equal(db.calls.at(-1), "release");
  assert.equal(db.calls.filter((c) => c.query).length, 1);
});
test("backend SSL true cannot admit missing, plaintext or unauthorized client transport", async () => {
  for (const stream of [
    undefined,
    {},
    { encrypted: false, authorized: true },
    { encrypted: true, authorized: false },
    { encrypted: true },
  ]) {
    const db = database({ stream, row: { ...identity, ssl: true } });
    await assert.rejects(verifyOwnerDatabase(db), /TLS_UNVERIFIED/);
    assert.deepEqual(db.calls, ["acquire", "release"]);
  }
});
test("verified TLS still rejects wrong owner identity and releases its connection", async () => {
  for (const change of [
    { database: "other" },
    { role: "grove_api" },
    { server: "170010" },
    { mismatch: "ignore" },
    { superuser: true },
  ]) {
    const db = database({
      stream: { encrypted: true, authorized: true },
      row: { ...identity, ...change },
    });
    await assert.rejects(verifyOwnerDatabase(db), /DATABASE_IDENTITY_DRIFT/);
    assert.equal(db.calls.at(-1), "release");
  }
});
test("owner query failure releases the checked connection without retrying", async () => {
  const error = new Error("query failed");
  const db = database({
    stream: { encrypted: true, authorized: true },
    queryError: error,
  });
  await assert.rejects(verifyOwnerDatabase(db), (e) => e === error);
  assert.equal(db.calls.at(-1), "release");
  assert.equal(db.calls.filter((c) => c.query).length, 1);
});
test("a raw SQL result alone cannot prove production client TLS", async () => {
  await assert.rejects(
    verifyOwnerDatabase({
      raw: () => assert.fail("unverified connection must not be queried"),
    }),
    /DATABASE_CONNECTION_REQUIRED/,
  );
});
test("owned local fixture keeps its separate database identity without network TLS", async () => {
  await verifyOwnerDatabase(
    { raw: async () => ({ rows: [{ ...identity, database: "grove_restore" }] }) },
    { fixture: true },
  );
});
