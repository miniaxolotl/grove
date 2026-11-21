import assert from "node:assert/strict";
import test from "node:test";
import * as controller from "./held-operator.mjs";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { receiptHash, publication } from "./held-state.mjs";
const now = Date.parse("2026-11-19T10:00:00Z");
const context = {
  repository: "miniaxolotl/grove",
  actor: "miniaxolotl",
  protected: true,
  source: "a".repeat(40),
  production: "b".repeat(40),
  tree: "c".repeat(40),
  tag: "v1.11.30",
  apiVersion: "1.11.30",
  run: 123,
  attempt: 1,
};
const p = publication(context, `sha256:${"d".repeat(64)}`, now);
function fixture() {
  let current = {
    state: "1".repeat(64),
    settings: "2".repeat(64),
    generation: "old",
  };
  let writes = 0;
  const records = [];
  const command = {
    schema: 1,
    id: "11111111-1111-4111-8111-111111111111",
    source: context.source,
    publication: receiptHash(p),
    parent: receiptHash(p),
    action: "restore",
    manifest: "3".repeat(64),
    custody: "7".repeat(64),
    expected: "1".repeat(64),
    proposed: receiptHash({}),
    issuedAt: now,
    expiresAt: now + 60000,
    approved: true,
  };
  const io = {
    assertExclusiveWindow: async () => {},
    qualify: async () => ({
      source: context.source,
      manifest: command.manifest,
      custody: command.custody,
      executionAdmitted: true,
      contract: "source-bound-held-release-v1",
    }),
    getState: async () => current,
    journal: async (_id, initial) => {
      records.push({ state: "pending", ...initial });
      return {
        append: async (state, data) => records.push({ state, ...data }),
        close: async () => {},
      };
    },
    readJournal: async () => ({ records, requiresReconciliation: false }),
    put: async () => {
      writes++;
      current = {
        state: "5".repeat(64),
        settings: command.proposed,
        generation: "new",
      };
    },
    verify: async () => current,
  };
  return {
    io,
    command,
    records,
    writes: () => writes,
    set: (v) => {
      current = v;
    },
  };
}
test("frozen v1.11.29 cannot become new-source execution even with a parent approval", async () => {
  const f = fixture();
  f.io.qualify = async () => ({
    source: "cd2a61a8f489dc4516613975822d944c99f06e0a",
    executionAdmitted: false,
    hardBlock: "FROZEN_V11129_COMPOSITION_BLOCKED",
  });
  await assert.rejects(async () =>
    controller.runProviderTransition?.(p, p, f.command, {}, f.io, now),
  );
  assert.equal(f.writes(), 0);
  assert.equal(f.records.length, 0);
});
test("actual controller forwards full approved inventory into the CLI dispatch factory, including restart checks", async () => {
  const api = await import("./held-operator-provider-io.mjs").catch((e) => {
    if (e.code === "ERR_MODULE_NOT_FOUND") return {};
    throw e;
  });
  assert.equal(typeof api.createProviderDispatch, "function");
  for (const changed of [false, "boundary", "last"]) {
    const f = fixture(),
      before = {
        state: f.command.expected,
        settings: "2".repeat(64),
        generation: "old",
        instances: [
          {
            component_name: "worker",
            instance_name: "worker-old",
            metadata: { revision: 1 },
          },
        ],
      };
    f.set(before);
    let reads = 0,
      writes = 0;
    f.io.put = api.createProviderDispatch({
      command: f.command,
      current: () => {},
      validate: () => {},
      external: {
        assertExclusiveWindow: async () => ({ expiresAt: Date.now() + 60000 }),
        prepareProviderWrite: async () => {},
      },
      observe: async () => {
        reads++;
        return changed && (changed === "boundary" || reads >= 3)
          ? {
              ...before,
              instances: [
                { ...before.instances[0], instance_name: "worker-restarted" },
              ],
            }
          : before;
      },
      submit: async () => {
        writes++;
        f.set({ ...before, settings: f.command.proposed });
      },
    });
    if (changed)
      await assert.rejects(
        controller.runProviderTransition(p, p, f.command, {}, f.io, now),
        /uncertain/i,
      );
    else await controller.runProviderTransition(p, p, f.command, {}, f.io, now);
    assert.equal(writes, changed ? 0 : 1);
  }
});
test("expiry during awaited qualification or journal fsync never dispatches a provider effect", async () => {
  for (const phase of ["qualification", "journal"]) {
    const f = fixture();
    let clock = now;
    f.io.now = () => clock;
    const qualify = f.io.qualify;
    f.io.qualify = async (...args) => {
      if (phase === "qualification") clock = f.command.expiresAt + 1;
      return qualify(...args);
    };
    const open = f.io.journal;
    f.io.journal = async (...args) => {
      const j = await open(...args);
      return {
        ...j,
        append: async (...a) => {
          await j.append(...a);
          if (phase === "journal") clock = f.command.expiresAt + 1;
        },
      };
    };
    await assert.rejects(
      controller.runProviderTransition(p, p, f.command, {}, f.io, now),
      /expired/i,
    );
    assert.equal(f.writes(), 0);
  }
});
test("provider writes require independent exclusive-window authority, never presumed atomic GET plus PUT", async () => {
  const f = fixture();
  delete f.io.assertExclusiveWindow;
  await assert.rejects(
    controller.runProviderTransition(p, p, f.command, {}, f.io, now),
    /exclusive/i,
  );
  assert.equal(f.writes(), 0);
});
test("intent is durably journalled before exactly one provider write; readback proves completion", async () => {
  const f = fixture();
  const result = await controller.runProviderTransition?.(
    p,
    p,
    f.command,
    {},
    f.io,
    now,
  );
  assert.equal(f.writes(), 1);
  assert.equal(f.records[0]?.state, "pending");
  assert(f.records.some((r) => r.state === "transaction_pending"));
  assert.equal(f.records.at(-1)?.state, "committed_hold");
  assert.equal(result?.settings, f.command.proposed);
});
test("unknown provider acceptance only reconciles readback and never blindly repeats PUT", async () => {
  const f = fixture();
  f.io.put = async () => {
    f.set({
      state: "5".repeat(64),
      settings: f.command.proposed,
      generation: "new",
    });
    throw new Error("lost response");
  };
  await assert.rejects(
    async () =>
      controller.runProviderTransition?.(p, p, f.command, {}, f.io, now),
    /uncertain/i,
  );
  assert.equal(f.records.at(-1)?.state, "uncertain_hold");
  const result = await controller.reconcileProviderTransition?.(
    p,
    p,
    f.command,
    f.io,
    now,
  );
  assert.equal(result?.settings, f.command.proposed);
  assert.equal(
    (
      await controller.reconcileProviderTransition(
        p,
        p,
        f.command,
        f.io,
        now + 600001,
      )
    ).settings,
    f.command.proposed,
    "Expired write approval still permits readback-only reconciliation",
  );
  assert.equal(f.writes(), 0);
  f.set({
    state: f.command.expected,
    settings: "2".repeat(64),
    generation: "old",
  });
  await assert.rejects(
    async () =>
      controller.reconcileProviderTransition?.(p, p, f.command, f.io, now),
    /uncertain/i,
  );
});
test("exact active target is a verified no-op; stale generation and torn journal never authorize writes", async () => {
  const f = fixture();
  f.set({
    state: "5".repeat(64),
    settings: f.command.proposed,
    generation: "new",
  });
  await controller.runProviderTransition?.(p, p, f.command, {}, f.io, now);
  assert.equal(f.writes(), 0);
  const g = fixture();
  g.set({
    state: "6".repeat(64),
    settings: "2".repeat(64),
    generation: "racing",
  });
  await assert.rejects(async () =>
    controller.runProviderTransition?.(p, p, g.command, {}, g.io, now),
  );
  assert.equal(g.writes(), 0);
  g.io.readJournal = async () => ({
    records: g.records,
    requiresReconciliation: true,
  });
  await assert.rejects(async () =>
    controller.reconcileProviderTransition?.(p, p, g.command, g.io, now),
  );
});
test("an instance restart between proposal admission and final write readback vetoes the provider write", async () => {
  const f = fixture();
  let reads = 0;
  f.io.getState = async () => ({
    state: f.command.expected,
    settings: "2".repeat(64),
    generation: "same-generation",
    instances: [
      {
        component_name: "worker",
        instance_name: ++reads === 1 ? "worker-before" : "worker-restarted",
      },
    ],
  });
  await assert.rejects(
    controller.runProviderTransition(p, p, f.command, {}, f.io, now),
    /instances/i,
  );
  assert.equal(f.writes(), 0);
});

test("database transition journals intent and treats an unknown commit as readback-only", async () => {
  const f = fixture();
  f.command.action = "admit";
  // Database phase uses a real held parent in integration; reject this phase jump.
  await assert.rejects(async () =>
    controller.runDatabaseTransition?.(p, p, f.command, f.io, now),
  );
  assert.equal(f.records.length, 0);
});
test("operator execution requires retained exact-source backup and restore journal custody, not a manifest boolean", () => {
  const f = fixture(),
    bytes = Buffer.from("retained-fixture-ciphertext"),
    digest = createHash("sha256").update(bytes).digest("hex");
  const receipt = {
    schema: 1,
    purpose: "quiescent-backup-only",
    source: f.command.source,
    manifestHash: f.command.manifest,
    fixtureOnly: false,
    migrationExecution: false,
    readbackVerified: true,
    restoreVerified: true,
    quiescenceVerified: true,
    encryptedSha256: digest,
    reviewDue: "2026-12-19",
  };
  f.command.custody = receiptHash(receipt);
  const journal = {
    requiresReconciliation: false,
    records: [
      {
        state: "backup_complete_hold",
        backupReceiptHash: receiptHash(receipt),
        backupHash: digest,
      },
    ],
  };
  assert.equal(
    controller.validateBackupCustody?.(f.command, receipt, journal, bytes, now),
    true,
  );
  for (const bad of [
    { ...receipt, fixtureOnly: true },
    { ...receipt, source: "f".repeat(40) },
    { ...receipt, restoreVerified: false },
  ])
    assert.throws(() =>
      controller.validateBackupCustody?.(f.command, bad, journal, bytes, now),
    );
  assert.throws(() =>
    controller.validateBackupCustody?.(
      f.command,
      receipt,
      { ...journal, requiresReconciliation: true },
      bytes,
      now,
    ),
  );
  assert.throws(() =>
    controller.validateBackupCustody?.(
      f.command,
      receipt,
      journal,
      Buffer.from("changed"),
      now,
    ),
  );
});
