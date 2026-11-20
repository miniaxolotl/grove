import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  rename,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { createControl } from "./operator-control.mjs";
import { createQualifier } from "./qualification.mjs";
import { hashJSON } from "./operator-control.mjs";
import { runProcess } from "./operator-io.mjs";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
const api = await import("./authority.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
test("real SQLite authority survives reopen/crash, fences roots and detects truncated/deleted journals without readback writes", async () => {
  assert.equal(typeof api.provisionAuthority, "function");
  const base = await mkdtemp(process.cwd() + "/.authority-");
  try {
    await mkdir(base + "/authority", { mode: 0o700 });
    await mkdir(base + "/work", { mode: 0o700 });
    const descriptor = await api.provisionAuthority({
      root: base + "/authority",
      workRoot: base + "/work",
      source: "a".repeat(40),
      codeHash: "b".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    const authority = api.openAuthority(descriptor),
      control = createControl(base + "/work", {
        anchor: authority,
        requireAnchors: true,
        expectedIdentity: descriptor.workIdentity,
      });
    const id = randomUUID(),
      path = base + "/work/j/" + id + ".jsonl";
    const journal = await control.openJournal(base + "/work/j", id, {
      source: "a".repeat(40),
      hold: true,
    });
    await journal.append("transaction_pending", { hold: true });
    await journal.close();
    const reopened = api.openAuthority(descriptor);
    assert.equal(
      (
        await reopened.head("j/" + id + ".jsonl", {
          rootIdentity: descriptor.workIdentity,
        })
      ).sequence,
      2,
    );
    const expired = "j/" + randomUUID() + ".jsonl";
    await assert.rejects(
      reopened.reserve(expired, {
        rootIdentity: descriptor.workIdentity,
        binding: "b".repeat(64),
        expiresAt: Date.now() - 1,
      }),
      /EXPIRED/,
    );
    await assert.rejects(
      reopened.head(expired, { rootIdentity: descriptor.workIdentity }),
      /MISSING/,
    );
    const snapshot = async () => {
      const files = {};
      for (const name of await readdir(descriptor.root))
        files[name] = (await readFile(join(descriptor.root, name))).toString(
          "hex",
        );
      return files;
    };
    const bytes = await snapshot();
    await reopened.status();
    await control.readJournal(path);
    assert.deepEqual(await snapshot(), bytes);
    // Scoped fixture qualification input; this is not a production admission.
    // Actual once-use state is exercised through independent SQLite processes.
    const manifest = {
      source: descriptor.source,
      hash: "d".repeat(64),
      executionAdmitted: true,
      contract: "source-bound-held-release-v1",
    };
    const command = {
      schema: 1,
      approved: true,
      id: randomUUID(),
      source: descriptor.source,
      manifest: manifest.hash,
      custody: "e".repeat(64),
      publication: "f".repeat(64),
      action: "restore",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    const qualify = createQualifier({
      control,
      manifest: async () => manifest,
      validateCustody: async (c) => assert.equal(c.custody, command.custody),
    });
    const scope = {
      source: command.source,
      publication: command.publication,
      command: hashJSON(command),
      action: command.action,
      consume: true,
    };
    const concurrent = await Promise.allSettled([
      qualify(scope, { command }),
      qualify(scope, { command }),
    ]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    const readOnlyBytes = await snapshot();
    await qualify({ ...scope, consume: false }, { command });
    assert.deepEqual(await snapshot(), readOnlyBytes);
    for (const change of [
      { source: "0".repeat(40) },
      { custody: "0".repeat(64) },
    ]) {
      const bad = { ...command, ...change };
      await assert.rejects(
        qualify(
          { ...scope, consume: false, command: hashJSON(bad) },
          { command: bad },
        ),
      );
      assert.deepEqual(await snapshot(), readOnlyBytes);
    }
    await writeFile(path, (await readFile(path, "utf8")).split("\n")[0] + "\n");
    await assert.rejects(control.readJournal(path), /ANCHOR/);
    await rm(path);
    await assert.rejects(
      control.openJournal(base + "/work/j", id, {
        source: "a".repeat(40),
        hold: true,
      }),
      /CONSUMED/,
    );
    await assert.rejects(
      api.provisionAuthority({
        root: descriptor.root,
        workRoot: descriptor.workRoot,
        source: descriptor.source,
        id: randomUUID(),
        custodyId: randomUUID(),
      }),
    );
    const crashKey = "crash/" + randomUUID() + ".jsonl";
    await assert.rejects(
      reopened.fixtureCrashAfterCommit("reserve", {
        key: crashKey,
        context: {
          rootIdentity: descriptor.workIdentity,
          binding: "b".repeat(64),
        },
      }),
    );
    const crashBytes = await snapshot();
    assert.equal(
      (await reopened.head(crashKey, { rootIdentity: descriptor.workIdentity }))
        .sequence,
      0,
    );
    assert.deepEqual(await snapshot(), crashBytes);
    await assert.rejects(
      reopened.reserve(crashKey, {
        rootIdentity: descriptor.workIdentity,
        binding: "b".repeat(64),
      }),
      /CONSUMED/,
    );
    await assert.rejects(
      reopened.fixtureCrashAfterCommit("advance", {
        key: crashKey,
        old: { sequence: 0, hash: null },
        next: { sequence: 1, hash: "c".repeat(64) },
        context: { rootIdentity: descriptor.workIdentity },
      }),
    );
    assert.equal(
      (await reopened.head(crashKey, { rootIdentity: descriptor.workIdentity }))
        .sequence,
      1,
    );
    await assert.rejects(
      reopened.advance(
        crashKey,
        { sequence: 0, hash: null },
        { sequence: 1, hash: "c".repeat(64) },
        { rootIdentity: descriptor.workIdentity },
      ),
      /CONFLICT/,
    );
    await assert.rejects(
      api.openAuthority({ ...descriptor, source: "f".repeat(40) }).status(),
      /IDENTITY/,
    );
    await assert.rejects(
      api.openAuthority({ ...descriptor, custodyId: randomUUID() }).status(),
      /IDENTITY/,
    );
    await rename(descriptor.workRoot, descriptor.workRoot + "-old");
    await mkdir(descriptor.workRoot, { mode: 0o700 });
    await assert.rejects(
      api.openAuthority(descriptor).status(),
      /IDENTITY|REPLACED/,
    );
    await assert.rejects(
      api
        .openAuthority({
          ...descriptor,
          workRoot: descriptor.workRoot + "-old",
        })
        .reserve("j/" + id + ".jsonl", {
          rootIdentity: descriptor.workIdentity,
          binding: "b".repeat(64),
        }),
      /IDENTITY|CONSUMED/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("explicit provisioning CLI persists independent identity and never reinitializes an existing authority", async () => {
  const base = await mkdtemp(process.cwd() + "/.authority-cli-");
  try {
    await mkdir(base + "/a", { mode: 0o700 });
    await mkdir(base + "/w", { mode: 0o700 });
    const request = {
      root: base + "/a",
      workRoot: base + "/w",
      source: "a".repeat(40),
      codeHash: "b".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    };
    await writeFile(base + "/request.json", JSON.stringify(request), {
      mode: 0o600,
    });
    const cli = fileURLToPath(new URL("./authority-cli.mjs", import.meta.url)),
      args = [
        cli,
        "provision",
        "--request",
        base + "/request.json",
        "--out",
        base + "/w/identity.json",
      ];
    const output = JSON.parse(
      (await runProcess(process.execPath, args)).toString(),
    );
    assert.equal(output.id, request.id);
    const independent = JSON.parse(await readFile(base + "/a/identity.json")),
      working = JSON.parse(await readFile(base + "/w/identity.json"));
    assert.deepEqual(independent, working);
    await api.openAuthority(independent).status();
    await assert.rejects(runProcess(process.execPath, args));
    assert.deepEqual(
      JSON.parse(await readFile(base + "/a/identity.json")),
      independent,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("existing authority in the wrong journal mode is rejected without repair or readback writes", async () => {
  const base = await mkdtemp(process.cwd() + "/.authority-mode-");
  try {
    await mkdir(base + "/a", { mode: 0o700 });
    await mkdir(base + "/w", { mode: 0o700 });
    const d = await api.provisionAuthority({
      root: base + "/a",
      workRoot: base + "/w",
      source: "a".repeat(40),
      codeHash: "b".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    await runProcess("/usr/bin/python3", [
      "-I",
      "-B",
      "-c",
      'import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);assert d.execute("PRAGMA journal_mode=DELETE").fetchone()[0]=="delete";d.close()',
      d.root + "/authority.sqlite3",
    ]);
    const bytes = await readFile(d.root + "/authority.sqlite3");
    await assert.rejects(api.openAuthority(d).status(), /WAL_REQUIRED/);
    assert.deepEqual(await readFile(d.root + "/authority.sqlite3"), bytes);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("reservation expiring while queued on the real cross-process authority lock is never inserted", async () => {
  const base = await mkdtemp(process.cwd() + "/.authority-expiry-");
  let locker;
  try {
    await mkdir(base + "/a", { mode: 0o700 });
    await mkdir(base + "/w", { mode: 0o700 });
    const d = await api.provisionAuthority({
      root: base + "/a",
      workRoot: base + "/w",
      source: "a".repeat(40),
      codeHash: "b".repeat(64),
      id: randomUUID(),
      custodyId: randomUUID(),
    });
    locker = runProcess("/usr/bin/python3", [
      "-I",
      "-B",
      "-c",
      'import fcntl,sys,time;f=open(sys.argv[1],"rb");fcntl.flock(f,fcntl.LOCK_EX);open(sys.argv[2],"w").write("locked");time.sleep(0.5)',
      d.root + "/authority.sqlite3",
      base + "/locked",
    ]);
    let locked = false;
    for (let i = 0; i < 200; i++) {
      try {
        await readFile(base + "/locked");
        locked = true;
        break;
      } catch {
        await wait(10);
      }
    }
    assert(locked);
    const a = api.openAuthority(d),
      key = "j/" + randomUUID() + ".jsonl";
    await assert.rejects(
      a.reserve(key, {
        rootIdentity: d.workIdentity,
        binding: "c".repeat(64),
        expiresAt: Date.now() + 100,
      }),
      /EXPIRED/,
    );
    await locker;
    await assert.rejects(
      a.head(key, { rootIdentity: d.workIdentity }),
      /MISSING/,
    );
  } finally {
    await locker?.catch(() => {});
    await rm(base, { recursive: true, force: true });
  }
});
