// Short owner-only operations using the independently qualified transaction
// wrapper. No provider request, migration, backlog deletion or backup occurs here.
import assert from "node:assert/strict";
import { receiptHash, validateHeldReceipt } from "./held-state.mjs";
import { holdIdentity } from "./held-provider.mjs";
import { performance } from "node:perf_hooks";
export function lifecycleBinding(p, parent, action) {
  validateHeldReceipt(parent, p);
  const held =
    action === "admit"
      ? parent
      : action === "handoff"
        ? parent.parent
        : parent.parent.parent.parent;
  assert.equal(held.phase, "held_verified");
  const expected = action === "admit" ? null : parent.evidence.lifecycle;
  const evidence = expected
    ? Object.fromEntries(
        Object.entries(expected).filter(([key]) => key !== "control"),
      )
    : null;
  return {
    release: receiptHash(holdIdentity(p)),
    receipt: receiptHash(held),
    evidence,
  };
}
export async function applyLifecycleTransition(
  db,
  boundedTransaction,
  p,
  parent,
  command,
  { assertFresh = () => {} } = {},
) {
  const wall = Date.now(),
    mono = performance.now();
  const fresh = () => {
    assertFresh();
    const elapsed = performance.now() - mono;
    assert(
      Math.abs(Date.now() - wall - elapsed) < 1000,
      "Operator clock changed",
    );
    assert(
      command.issuedAt <= wall + elapsed && command.expiresAt > wall + elapsed,
      "Operator command expired before SQL effect",
    );
  };
  const binding = lifecycleBinding(p, parent, command.action),
    hash = receiptHash(command);
  assertFresh({ beginTransaction: true });
  return boundedTransaction(db, async (trx) => {
    const control = await trx("lifecycle_release_control")
      .where({ singleton: true })
      .forUpdate()
      .first();
    if (command.action === "admit") {
      assert.equal(
        command.proposed,
        receiptHash({
          release: binding.release,
          receipt: binding.receipt,
          phase: "reconcile",
        }),
      );
      if (
        control?.releaseHash === binding.release &&
        control.receiptHash === binding.receipt
      )
        return { phase: control.phase };
      assert.equal(
        command.expected,
        receiptHash(control ?? null),
        "Persisted control changed",
      );
      assert(
        !control || control.phase === "public",
        "An unresolved earlier release cannot be replaced",
      );
      fresh();
      await trx("lifecycle_release_control")
        .insert({ releaseHash: binding.release, receiptHash: binding.receipt })
        .onConflict("singleton")
        .merge({
          releaseHash: binding.release,
          receiptHash: binding.receipt,
          generation: 0,
          phase: "reconcile",
          approvalHash: null,
          approvedGeneration: null,
          approvedAt: null,
          handoffEvidence: null,
          publicHash: null,
          publicEvidence: null,
        });
      return { phase: "reconcile" };
    }
    assert.equal(command.expected, receiptHash(binding.evidence));
    assert.equal(
      command.proposed,
      receiptHash({
        release: binding.release,
        receipt: binding.receipt,
        phase: command.action === "handoff" ? "handoff" : "public",
        evidence: binding.evidence,
      }),
    );
    fresh();
    if (command.action === "handoff")
      return (
        await trx.raw("SELECT grove_lifecycle_approve(?,?,?,?,?) AS evidence", [
          binding.release,
          binding.receipt,
          binding.evidence.generation,
          hash,
          JSON.stringify(binding.evidence),
        ])
      ).rows[0].evidence;
    assert.equal(command.action, "open-public");
    return (
      await trx.raw(
        "SELECT grove_lifecycle_open_public(?,?,?,?,?) AS evidence",
        [
          binding.release,
          parent.parent.evidence.reconciliation.command,
          hash,
          binding.evidence.generation,
          JSON.stringify(binding.evidence),
        ],
      )
    ).rows[0].evidence;
  });
}
export async function verifyLifecycleTransition(db, p, parent, command) {
  const binding = lifecycleBinding(p, parent, command.action);
  const proof = (
    await db.raw("SELECT grove_lifecycle_proof(?,?) AS evidence", [
      binding.release,
      binding.receipt,
    ])
  ).rows[0]?.evidence;
  assert(proof, "Missing persisted lifecycle admission");
  assert.equal(proof.release, binding.release);
  assert.equal(proof.receipt, binding.receipt);
  const control = await db("lifecycle_release_control")
    .where({ singleton: true })
    .first();
  assert.equal(control?.releaseHash, binding.release);
  assert.equal(control?.receiptHash, binding.receipt);
  if (command.action === "admit")
    assert.equal(proof.control.phase, "reconcile");
  else if (command.action === "handoff") {
    assert(["handoff", "released", "public"].includes(proof.control.phase));
    assert.equal(proof.control.approvalHash, receiptHash(command));
    assert.deepEqual(control.handoffEvidence, binding.evidence);
  } else {
    assert.equal(proof.control.phase, "public");
    assert.equal(proof.control.publicHash, receiptHash(command));
    assert.deepEqual(control.publicEvidence, binding.evidence);
  }
  const target = {
    release: control.releaseHash,
    receipt: control.receiptHash,
    phase:
      command.action === "admit"
        ? "reconcile"
        : command.action === "handoff"
          ? "handoff"
          : "public",
    ...(binding.evidence
      ? {
          evidence:
            command.action === "handoff"
              ? control.handoffEvidence
              : control.publicEvidence,
        }
      : {}),
  };
  assert.equal(
    receiptHash(target),
    command.proposed,
    "Persisted SQL target hash differs from approval",
  );
  return { ...proof, proofHash: receiptHash(target) };
}
