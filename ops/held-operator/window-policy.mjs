// Durable owner migration orchestration around the existing bounded barrier.
// No provider effects, role/login changes, lease clearing or automatic recovery.
import { need, hashJSON, uuid, safeCode } from "./operator-control.mjs";
import { createWindow, validatePreservation } from "./window-postgres.mjs";
import { readSnapshot } from "./catalog.mjs";
import { isFixtureDatabase } from "./operator-restore.mjs";
import { verifyOwnerDatabase } from "./window-db.mjs";
import { performance } from "node:perf_hooks";
export function createMigrationOperator({
  control,
  source,
  blueprint,
  manifest,
  validateCustody,
  observe,
  verify,
  validateHoldCustody,
  assertWindow,
  verifyWindow,
  prepareWindow,
  finishWindow,
  resolveWindow,
  scope = "production",
}) {
  need(["production", "fixture"].includes(scope), "MIGRATION_SCOPE_REJECTED");
  const window = createWindow({ source, blueprint, verify });
  async function gate({ db, plan, approval, readOnly = false }) {
    const m = await manifest(),
      now = Date.now();
    need(
      !m.hardBlock &&
        m.source === source.source &&
        (m.executionAdmitted === true || scope === "fixture"),
      "OPERATOR_NOT_QUALIFIED",
    );
    need(
      approval?.schema === 1 &&
        uuid(approval.id) &&
        approval.purpose === "migrate-045-048" &&
        approval.approved === true,
      "MIGRATION_APPROVAL_REQUIRED",
    );
    need(
      approval.source === source.source &&
        plan.source === source.source &&
        approval.manifest === m.hash &&
        plan.manifestHash === m.hash &&
        approval.planHash === hashJSON(plan),
      "MIGRATION_SOURCE_DRIFT",
    );
    need(
      Number.isSafeInteger(approval.issuedAt) &&
        Number.isSafeInteger(approval.expiresAt) &&
        approval.issuedAt <= now &&
        approval.expiresAt > approval.issuedAt &&
        approval.expiresAt - approval.issuedAt <= 300000 &&
        (readOnly || approval.expiresAt > now),
      "APPROVAL_EXPIRED",
    );
    const receipt = await validateCustody(approval);
    need(
      receipt?.fixtureOnly === (scope === "fixture") &&
        (scope !== "fixture" || isFixtureDatabase(db)),
      "LIVE_BACKUP_REQUIRED",
    );
    need(
      receipt.source === source.source &&
        receipt.manifestHash === m.hash &&
        receipt.completedAt >= approval.issuedAt - 300000 &&
        receipt.completedAt <= now &&
        (readOnly || now - receipt.completedAt <= 300000),
      "BACKUP_STALE",
    );
    need(
      ["catalogHash", "rowsetsHash", "mediaHash"].every(
        (k) => receipt[k] === plan.before[k],
      ),
      "BACKUP_AUTHORITY_DRIFT",
    );
    const held = await observe();
    need(
      held.archive &&
        held.maintenance &&
        held.settled &&
        !held.inProgress &&
        held.instances.length === 0 &&
        held.observedAt <= Date.now() &&
        Date.now() - held.observedAt <= 15000,
      "WRITERS_NOT_STOPPED",
    );
    need(
      held.fingerprint === plan.provider.fingerprint &&
        held.deploymentId === plan.provider.deploymentId &&
        receipt.heldSpecHash === held.fingerprint &&
        receipt.heldDeploymentId === held.deploymentId,
      "PROVIDER_DRIFT",
    );
    if (scope === "production") {
      need(
        typeof validateHoldCustody === "function",
        "LIVE_HOLD_CUSTODY_REQUIRED",
      );
      await validateHoldCustody(held);
    }
    if (scope === "production" || assertWindow) {
      if (readOnly) {
        need(typeof verifyWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
        await verifyWindow({ readOnly: true });
      } else {
        need(typeof assertWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
        const lease = await assertWindow(approval, held);
        return { ...m, lease };
      }
    }
    return m;
  }
  async function execute(input) {
    input = {
      ...input,
      plan: JSON.parse(JSON.stringify(input.plan)),
      approval: JSON.parse(JSON.stringify(input.approval)),
    };
    let leaseUntil = Infinity;
    const wall = Date.now(),
      mono = performance.now();
    const fresh = ({ beginTransaction = false } = {}) => {
      const elapsed = performance.now() - mono;
      need(Math.abs(Date.now() - wall - elapsed) < 1000, "CLOCK_CHANGED");
      need(input.approval.expiresAt > wall + elapsed, "APPROVAL_EXPIRED");
      need(
        leaseUntil - wall - elapsed > (beginTransaction ? 21000 : 0),
        "WINDOW_LEASE_EXPIRED",
      );
    };
    const m = await gate(input),
      { db, plan, approval } = input;
    const journal = await control.openJournal(
      control.root + "/migration-journals",
      approval.id,
      {
        source: source.source,
        manifestHash: m.hash,
        approvalHash: hashJSON(approval),
        planHash: approval.planHash,
        backupReceiptHash: approval.custody,
        hold: true,
        fixtureOnly: scope === "fixture",
      },
    );
    let committed = false;
    try {
      const refreshed = await gate(input);
      leaseUntil = refreshed.lease?.expiresAt ?? Infinity;
      await journal.append("transaction_pending", { hold: true });
      if (scope === "production" || prepareWindow) {
        need(typeof prepareWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
        await prepareWindow(approval, proof(approval));
      }
      fresh();
      const result = await window.applyUnderBarrier(db, plan.before, {
        assertFresh: fresh,
      });
      committed = true;
      await journal.append("committed_unverified_hold", { hold: true });
      // No remote I/O is performed inside the migration transaction.
      await gate(input);
      if (scope === "production" || finishWindow) {
        need(typeof finishWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
        await finishWindow(approval, proof(approval));
      }
      await journal.append("committed_hold", { hold: true });
      return {
        outcome: "committed_hold",
        applied: result.applied,
        reopen: false,
        fixtureOnly: scope === "fixture",
      };
    } catch (e) {
      const state = committed
        ? "committed_unverified_hold"
        : e.code === "COMMIT_UNKNOWN"
          ? "uncertain_hold"
          : e.rollbackConfirmed
            ? "rolled_back_hold"
            : "failed_hold";
      await journal.append(state, { code: safeCode(e), hold: true });
      throw e;
    } finally {
      await journal.close();
    }
  }
  async function reconcile(input) {
    const { db, plan, approval } = input;
    await gate({ ...input, readOnly: true });
    const j = await control.readJournal(
      control.root + "/migration-journals/" + approval.id + ".jsonl",
    );
    need(
      !j.requiresReconciliation &&
        j.records[0].approvalHash === hashJSON(approval) &&
        j.records[0].planHash === hashJSON(plan),
      "MIGRATION_JOURNAL_RECONCILIATION_REQUIRED",
    );
    // Explicit rollback even for a successful read. No journal append/consumption.
    await verifyOwnerDatabase(db, { fixture: isFixtureDatabase(db) });
    const trx = await db.transaction();
    try {
      await trx.raw("SET TRANSACTION READ ONLY");
      await trx.raw(
        "SET LOCAL statement_timeout='10000ms'; SET LOCAL transaction_timeout='10000ms'",
      );
      const after = await readSnapshot(trx, plan.before.columns);
      validatePreservation(plan.before, after, blueprint);
      return {
        outcome: "observed_committed_hold",
        applied: source.registry.slice(44),
        readOnly: true,
        reopen: false,
      };
    } finally {
      await trx.rollback();
    }
  }
  function proof(approval) {
    return hashJSON({
      source: source.source,
      registry: source.registry,
      plan: approval.planHash,
      custody: approval.custody,
    });
  }
  async function resolve(input) {
    const observed = await reconcile(input);
    need(typeof resolveWindow === "function", "EXCLUSIVE_WINDOW_REQUIRED");
    await resolveWindow(input.approval, proof(input.approval));
    return { ...observed, readOnly: false, authorityOnly: true };
  }
  return { execute, reconcile, resolve };
}
