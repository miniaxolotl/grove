import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { runProcess, createIO } from "./operator-io.mjs";
import { createControl } from "./operator-control.mjs";
import { Buffer } from "node:buffer";
test("subprocess errors identify the tool and nested tests do not inherit NODE_TEST_CONTEXT", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(2)"]),
    (e) => e.tool === process.execPath,
  );
  const output = await runProcess(process.execPath, [
    "-e",
    'console.log(process.env.NODE_TEST_CONTEXT ?? "absent")',
  ]);
  assert.equal(output.toString().trim(), "absent");
});
test("fixture symmetric encryption round-trips and leaves no detached agent for its owned homedir", async () => {
  const root = await mkdtemp(process.cwd() + "/.crypt-");
  try {
    const io = createIO({
      control: createControl(root),
      sourceRoot: process.cwd(),
      manifest: async () => ({ fixtureOnly: true }),
    });
    const key = "synthetic-process-test-key-not-a-production-secret";
    const encrypted = await io.crypt(Buffer.from("public-fixture"), key);
    assert.equal(
      (await io.crypt(encrypted, key, true)).toString(),
      "public-fixture",
    );
    const socket = (
      await runProcess("gpgconf", [
        "--homedir",
        root + "/gnupg",
        "--list-dirs",
        "agent-socket",
      ])
    )
      .toString()
      .trim();
    await assert.rejects(stat(socket), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("timeout and successful parent exit reap owned descendants even when they create a new session", async () => {
  const base = await mkdtemp(process.cwd() + "/.process-");
  try {
    for (const timeout of [true, false]) {
      const path = base + "/" + timeout + ".pid";
      let pid;
      const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync(${JSON.stringify(path)},String(child.pid));${timeout ? "setInterval(()=>{},1000)" : "child.unref()"}`;
      try {
        if (timeout)
          await assert.rejects(
            runProcess(process.execPath, ["-e", script], undefined, {
              timeoutMs: 500,
            }),
          );
        else await runProcess(process.execPath, ["-e", script]);
        pid = Number(await readFile(path, "utf8"));
        let alive = true;
        for (let i = 0; i < 30; i++) {
          try {
            alive = !/\) Z /.test(
              await readFile("/proc/" + pid + "/stat", "utf8"),
            );
          } catch {
            alive = false;
          }
          if (!alive) break;
          await wait(20);
        }
        assert.equal(alive, false, "owned descendant survived");
      } finally {
        if (pid)
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* own fixture already dead */
          }
      }
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
