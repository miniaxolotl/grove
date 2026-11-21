import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createControl } from "./operator-control.mjs";
import { provisionAuthority, openAuthority } from "./authority.mjs";
test("file fsync and anchor-CAS failures never acknowledge consumption or permit replay", async () => {
  for (const failure of ["fsync", "anchor"]) {
    const base = await fs.mkdtemp(process.cwd() + "/.control-failure-");
    try {
      await fs.mkdir(base + "/a", { mode: 0o700 });
      await fs.mkdir(base + "/w", { mode: 0o700 });
      const d = await provisionAuthority({
          root: base + "/a",
          workRoot: base + "/w",
          source: "a".repeat(40),
          codeHash: "b".repeat(64),
          id: randomUUID(),
          custodyId: randomUUID(),
        }),
        a = openAuthority(d),
        id = randomUUID();
      const fileSystem = {
        ...fs,
        open: async (path, ...args) => {
          const f = await fs.open(path, ...args);
          if (!String(path).endsWith(".jsonl")) return f;
          return new Proxy(f, {
            get(target, key) {
              if (key === "sync")
                return async () => {
                  throw Error("FSYNC_FAILED");
                };
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      };
      const control = createControl(d.workRoot, {
        anchor:
          failure === "anchor"
            ? {
                ...a,
                advance: async () => {
                  throw Error("ANCHOR_CAS_FAILED");
                },
              }
            : a,
        ...(failure === "fsync" ? { fileSystem } : {}),
      });
      await assert.rejects(
        control.openJournal(d.workRoot + "/j", id, {
          source: d.source,
          hold: true,
        }),
        failure === "fsync" ? /FSYNC_FAILED/ : /ANCHOR_CAS_FAILED/,
      );
      assert.equal(
        (await a.head("j/" + id + ".jsonl", { rootIdentity: d.workIdentity }))
          .sequence,
        0,
      );
      await assert.rejects(
        control.readJournal(d.workRoot + "/j/" + id + ".jsonl"),
        /ANCHOR/,
      );
      await assert.rejects(
        control.openJournal(d.workRoot + "/j", id, {
          source: d.source,
          hold: true,
        }),
        /CONSUMED/,
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  }
});
