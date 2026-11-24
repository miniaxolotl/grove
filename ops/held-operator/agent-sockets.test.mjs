import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, lstat, writeFile, symlink, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import process from "node:process";
import { pinDirectory } from "./pinned-path.mjs";
import { cleanupAgentSockets } from "./agent-sockets.mjs";

async function ownedHome(run) {
  const root = await mkdtemp(process.cwd() + "/.agent-sockets-");
  const pin = await pinDirectory(root);
  try {
    await run(pin, root);
  } finally {
    await pin.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("only refused sockets from a killed child are removed from the pinned private home", async () => {
  assert.equal(typeof cleanupAgentSockets, "function");
  await ownedHome(async (pin, root) => {
    const path = pin.path + "/S.gpg-agent";
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      'import {createServer} from "node:net";createServer().listen(process.argv[1],()=>process.stdout.write("ready"));',
      path,
    ]);
    try {
      const [ready] = await once(child.stdout, "data");
      assert.equal(ready.toString(), "ready");
      const closed = once(child, "exit");
      child.kill("SIGKILL");
      await closed;
      assert.equal((await lstat(path)).isSocket(), true);
      await writeFile(root + "/retained-file", "keep");
      await cleanupAgentSockets(pin);
      await assert.rejects(lstat(path), { code: "ENOENT" });
      assert.equal(await readFile(root + "/retained-file", "utf8"), "keep");
      await cleanupAgentSockets(pin);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, "exit");
        child.kill("SIGKILL");
        await closed;
      }
    }
  });
});

test("an accepting agent socket is retained and rejects cleanup", async () => {
  assert.equal(typeof cleanupAgentSockets, "function");
  await ownedHome(async (pin) => {
    const path = pin.path + "/S.gpg-agent";
    const server = createServer((socket) => socket.destroy());
    server.listen(path);
    await once(server, "listening");
    try {
      await assert.rejects(cleanupAgentSockets(pin), /GPG_AGENT_STILL_ACTIVE/);
      assert.equal((await lstat(path)).isSocket(), true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("regular files and symlinks at agent socket names are not removed", async () => {
  assert.equal(typeof cleanupAgentSockets, "function");
  await ownedHome(async (pin, root) => {
    await writeFile(root + "/retained-file", "keep");
    await writeFile(root + "/S.gpg-agent", "not a socket");
    await assert.rejects(cleanupAgentSockets(pin), /GPG_AGENT_SOCKET_REJECTED/);
    assert.equal(await readFile(root + "/S.gpg-agent", "utf8"), "not a socket");
    await rm(root + "/S.gpg-agent");
    await symlink(root + "/retained-file", root + "/S.gpg-agent");
    await assert.rejects(cleanupAgentSockets(pin), /GPG_AGENT_SOCKET_REJECTED/);
    assert.equal((await lstat(root + "/S.gpg-agent")).isSymbolicLink(), true);
    assert.equal(await readFile(root + "/retained-file", "utf8"), "keep");
  });
});

test("a failed pinned-home check prevents socket inspection or removal", async () => {
  let touched = false;
  await assert.rejects(
    cleanupAgentSockets({
      assert: async () => {
        throw Error("PINNED_ROOT_CHANGED");
      },
      get path() {
        touched = true;
        return "/must-not-be-read";
      },
    }),
    /PINNED_ROOT_CHANGED/,
  );
  assert.equal(touched, false);
});
