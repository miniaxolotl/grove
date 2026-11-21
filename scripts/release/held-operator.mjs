// One controller, not another publisher/migration/backup stack. The independent
// operator owns custody, qualification, private files and its fsynced journal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { receiptHash, validateHeldReceipt } from "./held-state.mjs";
const actions = {
  restore: "published_held",
  reconcile: "held_verified",
  "lifecycle-ingress": "held_verified",
  effects: "effects_approved",
  "public-health": "runtime_verified",
  admit: "held_verified",
  handoff: "lifecycle_verified",
  "open-public": "runtime_verified",
};
export function validateOperatorCommand(
  p,
  parent,
  command,
  now = Date.now(),
  readOnly = false,
) {
  validateHeldReceipt(parent, p);
  assert.deepEqual(
    Object.keys(command).sort(),
    [
      "schema",
      "id",
      "source",
      "publication",
      "parent",
      "action",
      "manifest",
      "custody",
      "expected",
      "proposed",
      "issuedAt",
      "expiresAt",
      "approved",
    ].sort(),
  );
  assert.equal(command.schema, 1);
  assert.equal(command.approved, true);
  assert.match(command.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(command.source, p.release.source);
  assert.equal(command.publication, receiptHash(p));
  assert.equal(command.parent, receiptHash(parent));
  assert.equal(parent.phase, actions[command.action]);
  assert(
    command.issuedAt <= now &&
      (readOnly || command.expiresAt > now) &&
      command.expiresAt > command.issuedAt &&
      command.expiresAt - command.issuedAt <= 300000,
    "Operator command expired; read-only reconciliation required",
  );
  for (const key of ["manifest", "custody", "expected", "proposed"])
    assert.match(command[key], /^[a-f0-9]{64}$/);
  return receiptHash(command);
}
export function validateBackupCustody(
  command,
  receipt,
  journal,
  ciphertext,
  now = Date.now(),
) {
  assert.equal(receipt.schema, 1);
  assert.equal(receipt.purpose, "quiescent-backup-only");
  assert.equal(receiptHash(receipt), command.custody);
  assert.equal(receipt.source, command.source);
  assert.equal(receipt.manifestHash, command.manifest);
  assert.equal(receipt.fixtureOnly, false);
  assert.equal(receipt.migrationExecution, false);
  for (const key of [
    "readbackVerified",
    "restoreVerified",
    "quiescenceVerified",
  ])
    assert.equal(receipt[key], true);
  assert.match(receipt.reviewDue, /^\d{4}-\d{2}-\d{2}$/);
  assert(
    now < Date.parse(`${receipt.reviewDue}T23:59:59Z`),
    "Original custody review is due",
  );
  assert.equal(
    createHash("sha256").update(ciphertext).digest("hex"),
    receipt.encryptedSha256,
  );
  assert.equal(journal.requiresReconciliation, false);
  assert.equal(
    journal.records.at(-1)?.state,
    "backup_complete_hold",
    "Backup journal has a later failed/uncertain outcome",
  );
  assert(
    journal.records.some(
      (record) =>
        record.state === "backup_complete_hold" &&
        record.backupReceiptHash === command.custody &&
        record.backupHash === receipt.encryptedSha256,
    ),
    "Independent backup journal does not confirm this receipt",
  );
  return true;
}
async function qualify(p, parent, command, io, now, consume = true) {
  validateOperatorCommand(p, parent, command, now, !consume);
  const qualification = await io.qualify({
    source: p.release.source,
    publication: receiptHash(p),
    command: receiptHash(command),
    action: command.action,
    consume,
  });
  assert.equal(
    qualification.executionAdmitted,
    true,
    "Independent operator execution is not admitted",
  );
  assert.equal(qualification.contract, "source-bound-held-release-v1");
  assert.equal(qualification.source, p.release.source);
  assert.equal(qualification.manifest, command.manifest);
  assert.equal(
    qualification.custody,
    command.custody,
    "Independent backup custody changed",
  );
  assert(
    !qualification.hardBlock,
    "Frozen execution contracts cannot be reused",
  );
}
function writeClock(io, start) {
  const mono = performance.now(),
    wall = Date.now();
  return () => {
    const elapsed = performance.now() - mono;
    assert(
      Math.abs(Date.now() - wall - elapsed) < 1000,
      "Operator clock changed; retain hold",
    );
    return io.now ? io.now() : start + elapsed;
  };
}
export async function runProviderTransition(
  p,
  parent,
  command,
  spec,
  io,
  now = Date.now(),
) {
  const current = writeClock(io, now);
  await qualify(p, parent, command, io, current());
  validateOperatorCommand(p, parent, command, current());
  assert.equal(
    (io.specFingerprint ?? receiptHash)(spec),
    command.proposed,
    "Provider proposal differs from approved command",
  );
  const before = await io.getState();
  // The qualified adapter validates settlement/topology and complete inventories.
  if (before.settings !== command.proposed)
    assert.equal(before.state, command.expected, "Provider generation drift");
  const journal = await io.journal(command.id, {
    source: p.release.source,
    manifestHash: command.manifest,
    approvalHash: receiptHash(command),
    planHash: receiptHash(parent),
    providerHash: command.proposed,
    hold: true,
  });
  try {
    if (before.settings !== command.proposed) {
      const fresh = await io.getState();
      assert.equal(fresh.state, command.expected);
      assert.deepEqual(
        fresh.instances,
        before.instances,
        "Provider instances changed before write",
      );
      await journal.append("transaction_pending", {
        providerHash: command.proposed,
        hold: true,
      });
      await qualify(p, parent, command, io, current(), false);
      assert.equal(
        typeof io.assertExclusiveWindow,
        "function",
        "Independent exclusive provider change window required; GET plus PUT is not atomic",
      );
      await io.assertExclusiveWindow(command, fresh);
      const dispatch = await io.getState();
      assert.equal(
        dispatch.state,
        command.expected,
        "Provider generation drift at dispatch",
      );
      assert.deepEqual(
        dispatch.instances,
        before.instances,
        "Provider instances changed at dispatch",
      );
      validateOperatorCommand(p, parent, command, current());
      try {
        await io.put(spec, dispatch);
      } catch {
        await journal.append("uncertain_hold", {
          providerHash: command.proposed,
          hold: true,
        });
        throw new Error(
          "Provider acceptance uncertain; use readback-only reconciliation, never replay PUT",
        );
      }
      await journal.append("committed_unverified_hold", {
        providerHash: command.proposed,
        hold: true,
      });
    }
    const observed = await io.verify();
    assert.equal(
      observed.settings,
      command.proposed,
      "Provider completion unverified",
    );
    await journal.append("committed_hold", {
      providerHash: command.proposed,
      hold: true,
    });
    return observed;
  } finally {
    await journal.close();
  }
}
export async function reconcileProviderTransition(
  p,
  parent,
  command,
  io,
  now = Date.now(),
) {
  await qualify(p, parent, command, io, now, false);
  const journal = await io.readJournal(command.id);
  assert.equal(
    journal.requiresReconciliation,
    false,
    "Torn journal requires operator investigation",
  );
  const initial = journal.records[0];
  assert(
    initial &&
      initial.approvalHash === receiptHash(command) &&
      initial.source === p.release.source &&
      initial.providerHash === command.proposed,
    "Journal custody drift",
  );
  const observed = await io.verify();
  assert.equal(
    observed.settings,
    command.proposed,
    "Provider acceptance remains uncertain; no automatic retry permitted",
  );
  return observed;
}
export async function runDatabaseTransition(
  p,
  parent,
  command,
  io,
  now = Date.now(),
) {
  const current = writeClock(io, now);
  await qualify(p, parent, command, io, current());
  validateOperatorCommand(p, parent, command, current());
  assert(["admit", "handoff", "open-public"].includes(command.action));
  const journal = await io.journal(command.id, {
    source: p.release.source,
    manifestHash: command.manifest,
    approvalHash: receiptHash(command),
    planHash: receiptHash(parent),
    hold: true,
  });
  try {
    await journal.append("transaction_pending", {
      approvalHash: receiptHash(command),
      hold: true,
    });
    let evidence;
    try {
      await qualify(p, parent, command, io, current(), false);
      assert.equal(
        typeof io.assertExclusiveWindow,
        "function",
        "Independent app window required before owner SQL",
      );
      assert.equal(
        typeof io.prepareDatabaseWrite,
        "function",
        "Durable owner SQL intent required",
      );
      const state = JSON.parse(JSON.stringify(await io.getState()));
      await io.assertExclusiveWindow(command, state);
      await io.prepareDatabaseWrite(command, state);
      const lease = await io.assertExclusiveWindow(
        command,
        await io.getState(),
      );
      const final = await io.getState();
      assert.equal(final.state, state.state, "Provider drift before owner SQL");
      assert.deepEqual(
        final.instances,
        state.instances,
        "Provider instances changed before owner SQL",
      );
      const assertFresh = ({ beginTransaction = false } = {}) => {
        validateOperatorCommand(p, parent, command, current());
        assert(
          lease?.expiresAt - current() > (beginTransaction ? 21000 : 0),
          "App window expires before bounded SQL",
        );
      };
      validateOperatorCommand(p, parent, command, current());
      assertFresh({ beginTransaction: true });
      evidence = await io.applyDatabase(p, parent, command, { assertFresh });
    } catch {
      await journal.append("uncertain_hold", {
        approvalHash: receiptHash(command),
        hold: true,
      });
      throw new Error(
        "Database outcome uncertain; reconcile persisted authority, never repeat an unknown commit",
      );
    }
    await journal.append("committed_unverified_hold", {
      approvalHash: receiptHash(command),
      hold: true,
    });
    const proof = await io.verifyDatabase(p, parent, command, evidence);
    assert.equal(
      typeof io.finishDatabaseWrite,
      "function",
      "Owner SQL completion authority required",
    );
    await io.finishDatabaseWrite(command, await io.getState(), proof);
    await journal.append("committed_hold", {
      approvalHash: receiptHash(command),
      hold: true,
    });
    return evidence;
  } finally {
    await journal.close();
  }
}
