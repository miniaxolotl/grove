import assert from "node:assert/strict";
import test from "node:test";
import { receiptHash, publication, recordHeld } from "./held-state.mjs";
import { applyLifecycleTransition } from "./held-lifecycle.mjs";
import { holdIdentity } from "./held-provider.mjs";
import { setTimeout } from "node:timers/promises";
const module = await import("./held-operator-qualification.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("owner SQL write rechecks expiry after an awaited locked-control read", async () => {
  const now = Date.now(),
    context = {
      repository: "miniaxolotl/grove",
      actor: "miniaxolotl",
      protected: true,
      source: "a".repeat(40),
      production: "b".repeat(40),
      tree: "c".repeat(40),
      tag: "v1.11.31",
      apiVersion: "1.11.31",
      run: 123,
      attempt: 1,
    };
  const p = publication(context, "sha256:" + "d".repeat(64), now);
  const instances = [
    { component: "api", name: "api-1" },
    { component: "worker", name: "worker-1" },
  ];
  const held = recordHeld(
    p,
    {
      fingerprint: "1".repeat(64),
      generation: "fixture",
      instances,
      proofs: instances.map((i, n) => ({
        ...i,
        challenge: String(n + 2).repeat(64),
        response: "3".repeat(64),
      })),
      observedAt: new Date(now).toISOString(),
    },
    context,
    now,
  );
  const command = {
    action: "admit",
    issuedAt: now,
    expiresAt: now + 1,
    expected: receiptHash(null),
    proposed: receiptHash({
      release: receiptHash(holdIdentity(p)),
      receipt: receiptHash(held),
      phase: "reconcile",
    }),
  };
  let writes = 0;
  const chain = {
    where() {
      return this;
    },
    forUpdate() {
      return this;
    },
    async first() {
      await setTimeout(10);
      return undefined;
    },
    insert() {
      writes++;
      throw Error("SQL_WRITE_DISPATCHED");
    },
  };
  await assert.rejects(
    applyLifecycleTransition(
      {},
      async (_db, run) => run(() => chain),
      p,
      held,
      command,
    ),
    /expired/,
  );
  assert.equal(writes, 0);
});

test("CLI forwards exact controller qualification including consume without manufacturing admission", async () => {
  assert.equal(typeof module.qualifyIndependent, "function");
  const command = {
    id: "test",
    source: "a".repeat(40),
    publication: "b".repeat(64),
    action: "restore",
    manifest: "c".repeat(64),
    custody: "d".repeat(64),
  };
  const manifest = {
    source: command.source,
    hash: command.manifest,
    executionAdmitted: true,
    contract: "source-bound-held-release-v1",
  };
  const scope = {
    source: command.source,
    publication: command.publication,
    command: receiptHash(command),
    action: command.action,
    consume: false,
  };
  let forwarded = 0;
  const context = {
    command,
    manifest,
    current: () => {},
    plans: { operatorManifest: async () => manifest },
    validateCustody: async () => {},
    external: {
      qualify: async (s, binding) => {
        forwarded++;
        assert.deepEqual(s, scope);
        assert.equal(binding.command, command);
        return { executionAdmitted: false };
      },
    },
  };
  await assert.rejects(module.qualifyIndependent(context, scope), /qualified/i);
  assert.equal(forwarded, 1);
  context.external.qualify = async (s) => {
    assert.deepEqual(s, scope);
    return {
      executionAdmitted: true,
      contract: "source-bound-held-release-v1",
      source: command.source,
      manifest: command.manifest,
      custody: command.custody,
    };
  };
  assert.equal(
    (await module.qualifyIndependent(context, scope)).executionAdmitted,
    true,
  );
  for (const change of [
    { source: "e".repeat(40) },
    { publication: "e".repeat(64) },
    { command: "e".repeat(64) },
    { action: "effects" },
    { consume: undefined },
  ]) {
    await assert.rejects(
      module.qualifyIndependent(context, { ...scope, ...change }),
    );
  }
});
