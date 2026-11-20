import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import {
  mkdtemp,
  mkdir,
  rename,
  symlink,
  rm,
  readdir,
  open,
  realpath,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { join } from "node:path";
import { URL } from "node:url";
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

test("socket-leaf replacement after mount verification cannot redirect PG connections or cleanup", async () => {
  const base = await mkdtemp(process.cwd() + "/.restore-leaf-");
  const servers = [],
    handles = [],
    peers = [],
    queries = [],
    dockerCalls = [];
  let fixture, leaf, mountSource, originalHandle, replacementHandle;
  async function serve(handle, identity) {
    // The test servers also bind through their own retained handles, so test
    // teardown cannot accidentally unlink a replacement leaf's socket.
    const path = `/proc/${process.pid}/fd/${handle.fd}/.s.PGSQL.5432`;
    const server = createServer((socket) => {
      socket.write(identity);
      socket.on("error", () => {});
    });
    servers.push(server);
    await new Promise((r, j) => {
      server.once("error", j);
      server.listen(path, r);
    });
  }
  class SocketClient {
    constructor(options) {
      this.options = options;
    }
    on() {
      return this;
    }
    async connect() {
      this.socket = createConnection(join(this.options.host, ".s.PGSQL.5432"));
      this.peer = await new Promise((r, j) => {
        this.socket.once("error", j);
        this.socket.once("data", (data) => r(data.toString()));
      });
      peers.push(this.peer);
    }
    async query(sql) {
      queries.push({ sql, peer: this.peer });
      return {
        rows: sql.includes("current_setting('server_version_num')")
          ? [{ server: "170012", mismatch: "error" }]
          : [],
      };
    }
    async end() {
      if (this.socket && !this.socket.destroyed)
        await new Promise((r) => {
          this.socket.once("close", r);
          this.socket.destroy();
        });
    }
  }
  try {
    await mkdir(base + "/root", { mode: 0o700 });
    const restorer = createRestorer({
      control: createControl(base + "/root"),
      sourceRoot: process.cwd(),
      clientFactory: (options) => new SocketClient(options),
      run: async (tool, args) => {
        assert.equal(tool, "docker");
        dockerCalls.push(args);
        if (args[0] === "image") return Buffer.from(IMAGE);
        if (args[0] === "run") {
          mountSource = /src=(.*),dst=\/socket/.exec(
            args[args.indexOf("--mount") + 1],
          )[1];
          leaf = await realpath(mountSource);
          originalHandle = await open(leaf, "r");
          handles.push(originalHandle);
          await serve(originalHandle, "original");
          return Buffer.from("fixture-container");
        }
        if (args[0] === "exec" && args[2] === "stat") {
          const s = await originalHandle.stat();
          return Buffer.from(`${s.dev}:${s.ino}`);
        }
        if (args[0] === "inspect") {
          // This call occurs only after mount identity has been accepted. Replace
          // ONLY the child; the source/root directories and their identities stay.
          await rename(leaf, base + "/retained-socket");
          await mkdir(leaf, { mode: 0o700 });
          await writeFile(leaf + "/replacement-sentinel", "must remain");
          replacementHandle = await open(leaf, "r");
          handles.push(replacementHandle);
          await serve(replacementHandle, "replacement");
          return Buffer.from("none");
        }
        return Buffer.alloc(0);
      },
    });
    fixture = await restorer.createRestoreFixture();
    const c = fixture.connect();
    await c.connect();
    await c.query("fixture readback");
    await c.end();
    const viaReturnedPath = new SocketClient({ host: fixture.socketPath });
    await viaReturnedPath.connect();
    await viaReturnedPath.query("returned-path readback");
    await viaReturnedPath.end();
    const owner = await fixture.ownerDatabase();
    try {
      const host = new URL(
        owner.client.config.connection.connectionString,
      ).searchParams.get("host");
      assert.equal(
        host,
        fixture.socketPath,
        "owner database URL must retain the pinned socket leaf",
      );
      const viaOwnerURL = new SocketClient({ host });
      await viaOwnerURL.connect();
      await viaOwnerURL.query("owner-url readback");
      await viaOwnerURL.end();
    } finally {
      await owner.destroy();
    }
    await assert.rejects(fixture.close(), /FIXTURE_SCRATCH_CHANGED/);
    assert.equal(
      await readFile(leaf + "/replacement-sentinel", "utf8"),
      "must remain",
    );
    assert.equal(
      (await stat(leaf)).mode & 0o777,
      0o700,
      "cleanup must not chmod the replacement",
    );
    assert(
      queries.length > 2,
      "exercise bootstrap SQL as well as later client construction",
    );
    assert.deepEqual(
      [...new Set(peers)],
      ["original"],
      "a PG client followed the replaced leaf",
    );
    assert(
      queries.every((q) => q.peer === "original"),
      "SQL reached the replacement socket",
    );
    assert.match(
      mountSource,
      /^\/proc\/\d+\/fd\/\d+$/,
      "daemon must bind the child handle itself",
    );
    assert.equal(
      fixture.socketPath,
      mountSource,
      "every returned PG socket path must use the same pinned child",
    );
    assert(
      dockerCalls.some((args) => args[0] === "stop") &&
        dockerCalls.some((args) => args[0] === "rm"),
    );
  } finally {
    await fixture?.close().catch(() => {});
    for (const server of servers) await new Promise((r) => server.close(r));
    for (const handle of handles) await handle.close();
    await rm(base, { recursive: true, force: true });
  }
});
