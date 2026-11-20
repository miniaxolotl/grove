import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import {
  mkdtemp,
  writeFile,
  chmod,
  symlink,
  appendFile,
  rm,
  rename,
  mkdir,
  readFile,
  link,
} from "node:fs/promises";
import { join } from "node:path";
const module = await import("./operator-control.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("pinned root refuses replacement and an independent anchor detects complete-prefix truncation/deletion", async () => {
  const root = await mkdtemp(join(process.cwd(), ".operator-anchor-"));
  const heads = new Map(); // interface fixture, deliberately not a live durable authority
  const anchor = {
    reserve: async (key) => {
      assert(!heads.has(key), "APPROVAL_ALREADY_CONSUMED");
      heads.set(key, { sequence: 0, hash: null });
    },
    advance: async (key, old, next) => {
      assert.deepEqual(heads.get(key), old);
      heads.set(key, next);
    },
    head: async (key) => heads.get(key),
  };
  try {
    const c = module.createControl(root, { anchor, requireAnchors: true }),
      id = "11111111-1111-4111-8111-111111111111";
    const j = await c.openJournal(root + "/j", id, { hold: true });
    await j.append("transaction_pending", { hold: true });
    await j.close();
    const path = root + "/j/" + id + ".jsonl",
      bytes = await readFile(path);
    await writeFile(path, bytes.toString().split("\n")[0] + "\n");
    await assert.rejects(c.readJournal(path), /ANCHOR/);
    await rm(path);
    await assert.rejects(
      c.openJournal(root + "/j", id, { hold: true }),
      /ALREADY_CONSUMED/,
    );
    await rename(root, root + "-moved");
    await mkdir(root, { mode: 0o700 });
    await writeFile(root + "/replaced.json", "{}", { mode: 0o600 });
    await assert.rejects(
      c.readPrivate(root + "/replaced.json"),
      /ROOT_REPLACED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(root + "-moved", { recursive: true, force: true });
  }
});
test("production private state cannot use filename-only replay protection", async () => {
  const root = await mkdtemp(join(process.cwd(), ".operator-anchor-"));
  try {
    const c = module.createControl(root, { requireAnchors: true });
    await assert.rejects(
      c.openJournal(root + "/j", "11111111-1111-4111-8111-111111111111", {}),
      /DURABLE_JOURNAL_AUTHORITY_REQUIRED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private root factory fences paths, permissions, links, replay and torn journals", async () => {
  assert.equal(typeof module.createControl, "function");
  const root = await mkdtemp(join(process.cwd(), ".operator-control-"));
  try {
    const c = module.createControl(root),
      id = "11111111-1111-4111-8111-111111111111";
    await c.durableWrite(root + "/safe.json", JSON.stringify({ safe: true }));
    assert.deepEqual(await c.readPrivate(root + "/safe.json"), { safe: true });
    await assert.rejects(c.readPrivate(root + "/../package.json"));
    await symlink(root + "/safe.json", root + "/symlink.json");
    await assert.rejects(c.readPrivate(root + "/symlink.json"));
    await link(root + "/safe.json", root + "/hard.json");
    await assert.rejects(c.readPrivate(root + "/hard.json"));
    await writeFile(root + "/public.json", "{}", { mode: 0o644 });
    await chmod(root + "/public.json", 0o644);
    await assert.rejects(c.readPrivate(root + "/public.json"));
    const journal = await c.openJournal(root + "/journals", id, {
      source: "a".repeat(40),
      hold: true,
    });
    await journal.append("transaction_pending", { hold: true });
    await journal.close();
    assert.equal(
      (await c.readJournal(root + "/journals/" + id + ".jsonl")).last.state,
      "transaction_pending",
    );
    await assert.rejects(
      c.openJournal(root + "/journals", id, {}),
      /APPROVAL_ALREADY_CONSUMED/,
    );
    await appendFile(root + "/journals/" + id + ".jsonl", '{"torn":');
    const torn = await c.readJournal(root + "/journals/" + id + ".jsonl");
    assert.equal(torn.requiresReconciliation, true);
    assert.equal(torn.records.length, 2);
    await chmod(root, 0o755);
    await assert.rejects(c.readPrivate(root + "/public.json"));
  } finally {
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});
