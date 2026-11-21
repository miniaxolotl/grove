import assert from "node:assert/strict";
import test from "node:test";
import * as backup from "./operator-backup.mjs";
test("a caller fixture boolean or fabricated handle cannot select live backup I/O without qualification", async () => {
  assert.equal(typeof backup.fixtureBackupTarget, "function");
  assert.throws(
    () =>
      backup.fixtureBackupTarget({
        name: "grove-qualified-restore-fabricated",
        connect: () => {},
      }),
    /FIXTURE/,
  );
  const adapter = backup.createBackup({
    source: { source: "a" },
    manifest: async () => ({ hash: "hash", source: "a" }),
  });
  await assert.rejects(
    adapter.captureQuiescentBackup({
      manifestHash: "hash",
      target: {
        kind: "local-fixture",
        connect: () => assert.fail("no connection"),
      },
    }),
    /BACKUP_TARGET_REJECTED/,
  );
});
