import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openAuthority, provisionAuthority } from "./authority.mjs";
import { createControl } from "./operator-control.mjs";
import {
  publication,
  recordHeld,
  receiptHash,
} from "../../scripts/release/held-state.mjs";
import { runDatabaseTransition } from "../../scripts/release/held-operator.mjs";
test("owner SQL controller contends with provider/migration commands; lost COMMIT stays quarantined after readback", async () => {
  for (const priorKind of ["provider", "migration", null]) {
    const base = await mkdtemp(process.cwd() + "/.sql-window-");
    try {
      for (const p of ["a", "w"]) await mkdir(base + "/" + p, { mode: 0o700 });
      const d = await provisionAuthority({
          root: base + "/a",
          workRoot: base + "/w",
          source: "a".repeat(40),
          codeHash: "b".repeat(64),
          id: randomUUID(),
          custodyId: randomUUID(),
        }),
        a = openAuthority(d),
        now = Date.now();
      const ctx = {
          repository: "miniaxolotl/grove",
          actor: "miniaxolotl",
          protected: true,
          source: d.source,
          production: "b".repeat(40),
          tree: "c".repeat(40),
          tag: "v1.11.32",
          apiVersion: "1.11.32",
          run: 123,
          attempt: 1,
        },
        p = publication(ctx, "sha256:" + "d".repeat(64), now);
      const instances = [
          { component: "api", name: "api-one" },
          { component: "worker", name: "worker-one" },
        ],
        parent = recordHeld(
          p,
          {
            fingerprint: "e".repeat(64),
            generation: "held",
            instances,
            proofs: instances.map((i, n) => ({
              ...i,
              challenge: String(n + 1).repeat(64),
              response: "f".repeat(64),
            })),
            observedAt: new Date(now).toISOString(),
          },
          ctx,
          now,
        );
      const command = {
        schema: 1,
        id: randomUUID(),
        source: d.source,
        publication: receiptHash(p),
        parent: receiptHash(parent),
        action: "admit",
        manifest: "1".repeat(64),
        custody: "2".repeat(64),
        expected: "3".repeat(64),
        proposed: "4".repeat(64),
        issuedAt: now,
        expiresAt: now + 60000,
        approved: true,
      };
      const binding = {
          source: d.source,
          authorityId: d.id,
          custodyId: d.custodyId,
          app: d.app,
          digest: p.release.digest,
          issuedAt: now,
          expiresAt: now + 60000,
          leaseMs: 60000,
        },
        observed = {
          state: "5".repeat(64),
          settings: "6".repeat(64),
          instances: "7".repeat(64),
          generation: "held",
        },
        owner = randomUUID();
      const req = (c) => ({
        binding,
        certificateHash: "8".repeat(64),
        owner,
        commandHash: receiptHash(c),
        observed,
        expected: observed.state,
        proposed: c.proposed,
        kind: "sql",
        proofHash: c.proposed,
      });
      if (priorKind) {
        const prior = {
            ...req(command),
            commandHash: "9".repeat(64),
            kind: priorKind,
            owner: randomUUID(),
          },
          lease = await a.call("window-assert", prior);
        await a.call("window-prepare", { ...prior, fence: lease.fence });
      }
      let lease,
        sqlWrites = 0,
        persisted = false;
      const control = createControl(d.workRoot, {
        anchor: a,
        expectedIdentity: d.workIdentity,
      });
      const io = {
        getState: async () => observed,
        qualify: async () => ({
          executionAdmitted: true,
          contract: "source-bound-held-release-v1",
          source: d.source,
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
        applyDatabase: async () => {
          sqlWrites++;
          persisted = true;
          throw Error("COMMIT acknowledgment lost");
        },
        verifyDatabase: async () => {
          assert(persisted);
          return { proofHash: command.proposed };
        },
      };
      await assert.rejects(
        runDatabaseTransition(p, parent, command, io),
        /UNCERTAIN|uncertain|BUSY|window/i,
      );
      assert.equal(sqlWrites, priorKind ? 0 : 1);
      if (!priorKind) {
        const snapshot = async () =>
          Object.fromEntries(
            await Promise.all(
              (await readdir(d.root)).map(async (n) => [
                n,
                (await readFile(d.root + "/" + n)).toString("hex"),
              ]),
            ),
          );
        const before = await snapshot();
        const proof = await io.verifyDatabase();
        await a.call("window-readback", {
          ...req(command),
          proofHash: proof.proofHash,
        });
        assert.deepEqual(await snapshot(), before);
        await assert.rejects(
          a.call("window-assert", {
            ...req({ ...command, id: randomUUID() }),
            owner: randomUUID(),
          }),
          /UNCERTAIN|BUSY/,
        );
        await a.call("window-resolve-sql", {
          ...req(command),
          binding: { ...binding, issuedAt: Date.now() },
          certificateHash: "a".repeat(64),
          proofHash: proof.proofHash,
        });
        await a.call("window-assert", {
          ...req({ ...command, id: randomUUID() }),
          owner: randomUUID(),
        });
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }
});
