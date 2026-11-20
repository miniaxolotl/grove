import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rename, symlink, rm, readdir } from "node:fs/promises";
import { createControl } from "./operator-control.mjs";
import { createRestorer } from "./operator-restore.mjs";
import { IMAGE } from "./operator-io.mjs";
test("restore root replacement during a tool await vetoes mount and cleanup stays on the old pinned directory", async () => {
  const base = await mkdtemp(process.cwd() + "/.restore-race-");
  try {
    await mkdir(base + "/root", { mode: 0o700 });
    await mkdir(base + "/outside", { mode: 0o700 });
    let mounts = 0;
    const restorer = createRestorer({
      control: createControl(base + "/root"),
      sourceRoot: process.cwd(),
      run: async (_tool, args) => {
        if (args[0] === "image") {
          await rename(base + "/root", base + "/moved");
          await symlink(base + "/outside", base + "/root");
          return Buffer.from(IMAGE);
        }
        mounts++;
        throw Error("mount must not happen");
      },
    });
    await assert.rejects(restorer.createRestoreFixture(), /ROOT|ENOTDIR/);
    assert.equal(mounts, 0);
    assert.deepEqual(await readdir(base + "/outside"), []);
    assert.deepEqual(await readdir(base + "/moved"), []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
