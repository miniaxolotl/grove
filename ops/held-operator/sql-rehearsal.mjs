// Called only by the parent's populated disposable PG rehearsal. No live target.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createControl } from "./operator-control.mjs";
import { provisionAuthority, openAuthority } from "./authority.mjs";
import { recordHeld, receiptHash } from "../../scripts/release/held-state.mjs";
import {
  lifecycleBinding,
  applyLifecycleTransition,
  verifyLifecycleTransition,
} from "../../scripts/release/held-lifecycle.mjs";
import { runDatabaseTransition } from "../../scripts/release/held-operator.mjs";
import { boundedTransaction } from "./window-db.mjs";
import { isFixtureDatabase } from "./operator-restore.mjs";
export async function rehearseOwnerSQL({
  db,
  root,
  source,
  manifest,
  p,
  context,
}) {
  assert(
    isFixtureDatabase(db),
    "Only an owned disposable database may run SQL rehearsal",
  );
  for (const name of ["sql-authority", "sql-work"])
    await mkdir(root + "/" + name, { mode: 0o700 });
  const d = await provisionAuthority({
      root: root + "/sql-authority",
      workRoot: root + "/sql-work",
      source,
      codeHash: "f".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    }),
    a = openAuthority(d),
    control = createControl(d.workRoot, {
      anchor: a,
      expectedIdentity: d.workIdentity,
    });
  const at = Date.now(),
    instances = [
      { component: "api", name: "api-fixture" },
      { component: "worker", name: "worker-fixture" },
    ];
  const parent = recordHeld(
    p,
    {
      fingerprint: "a".repeat(64),
      generation: "held-fixture",
      instances,
      proofs: instances.map((i, n) => ({
        ...i,
        challenge: String(n + 1).repeat(64),
        response: "b".repeat(64),
      })),
      observedAt: new Date(at).toISOString(),
    },
    context,
    at,
  );
  const binding = lifecycleBinding(p, parent, "admit"),
    before = await db("lifecycle_release_control")
      .where({ singleton: true })
      .first();
  const command = {
    schema: 1,
    id: randomUUID(),
    source,
    publication: receiptHash(p),
    parent: receiptHash(parent),
    action: "admit",
    manifest: manifest.hash,
    custody: "c".repeat(64),
    expected: receiptHash(before ?? null),
    proposed: receiptHash({
      release: binding.release,
      receipt: binding.receipt,
      phase: "reconcile",
    }),
    issuedAt: at,
    expiresAt: at + 60000,
    approved: true,
  };
  const windowBinding = {
    source,
    authorityId: d.id,
    custodyId: d.custodyId,
    app: d.app,
    digest: p.release.digest,
    issuedAt: at,
    expiresAt: at + 60000,
    leaseMs: 60000,
  };
  const observed = {
      state: "1".repeat(64),
      settings: "2".repeat(64),
      instances: "3".repeat(64),
      generation: "held-fixture",
    },
    owner = randomUUID();
  const req = (c) => ({
    binding: windowBinding,
    certificateHash: "4".repeat(64),
    owner,
    commandHash: receiptHash(c),
    observed,
    expected: observed.state,
    proposed: c.proposed,
    kind: "sql",
    proofHash: c.proposed,
  });
  let lease,
    commits = 0;
  const io = {
    getState: async () => observed,
    qualify: async () => ({
      executionAdmitted: true,
      contract: "source-bound-held-release-v1",
      source,
      manifest: command.manifest,
      custody: command.custody,
    }),
    journal: (id, initial) =>
      control.openJournal(d.workRoot + "/sql", id, initial),
    assertExclusiveWindow: async (c) =>
      (lease = await a.call("window-assert", req(c))),
    prepareDatabaseWrite: (c) =>
      a.call("window-prepare", { ...req(c), fence: lease.fence }),
    finishDatabaseWrite: (c, _s, proof) =>
      a.call("window-finish", {
        ...req(c),
        fence: lease.fence,
        proofHash: proof.proofHash,
      }),
    applyDatabase: async (...args) => {
      await applyLifecycleTransition(db, boundedTransaction, ...args);
      commits++;
      throw Error("Fixture lost COMMIT acknowledgment");
    },
    verifyDatabase: (...args) => verifyLifecycleTransition(db, ...args),
  };
  await assert.rejects(
    runDatabaseTransition(p, parent, command, io),
    /uncertain/i,
  );
  assert.equal(commits, 1);
  const proof = await verifyLifecycleTransition(db, p, parent, command);
  assert.equal(proof.proofHash, command.proposed);
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        (await readdir(d.root)).map(async (n) => [
          n,
          (await readFile(d.root + "/" + n)).toString("hex"),
        ]),
      ),
    );
  const bytes = await snapshot();
  await a.call("window-readback", {
    ...req(command),
    proofHash: proof.proofHash,
  });
  assert.deepEqual(await snapshot(), bytes);
  for (const kind of ["provider", "migration", "sql"])
    await assert.rejects(
      a.call("window-assert", {
        ...req({ ...command, id: randomUUID() }),
        kind,
        owner: randomUUID(),
      }),
      /UNCERTAIN|BUSY/,
    );
  await a.call("window-resolve-sql", {
    ...req(command),
    binding: { ...windowBinding, issuedAt: Date.now() },
    certificateHash: "5".repeat(64),
    proofHash: proof.proofHash,
  });
  const next = {
    ...req({ ...command, id: randomUUID() }),
    owner: randomUUID(),
  };
  await a.call("window-assert", next);
  assert.equal(commits, 1);
  return { commits, readbackVerified: true, authorityResolved: true };
}
