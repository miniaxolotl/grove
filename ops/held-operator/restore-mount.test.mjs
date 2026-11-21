import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import {
  mkdtemp,
  mkdir,
  open,
  rename,
  rm,
  stat,
  writeFile,
  readFile,
} from "node:fs/promises";
import { createControl } from "./operator-control.mjs";
import { createRestorer } from "./operator-restore.mjs";
import { IMAGE } from "./operator-io.mjs";

// A data-shaped daemon adapter: procfd bind sources reproduce runc's failure;
// mounting and starting PostgreSQL are separate observable effects.
async function exercise(
  t,
  { wrongMount = false, wrongIdentity = false, policy, failAt } = {},
) {
  const base = await mkdtemp(process.cwd() + "/.restore-mount-");
  let mount,
    source,
    container,
    token,
    started = false,
    clientCount = 0;
  const events = [];
  t.after(async () => {
    await mount?.close();
    await rm(base, { recursive: true, force: true });
  });
  await mkdir(base + "/root", { mode: 0o700 });
  const restorer = createRestorer({
    control: createControl(base + "/root"),
    sourceRoot: process.cwd(),
    clientFactory: () => {
      clientCount++;
      assert(started, "no PG client may exist before the start gate");
      return {
        on() {},
        async connect() {
          events.push("connect");
        },
        async query(sql) {
          assert(started);
          events.push("query");
          return {
            rows: sql.includes("server_version_num")
              ? [{ server: "170012", mismatch: "error" }]
              : [],
          };
        },
        async end() {},
      };
    },
    run: async (tool, args, _input, options) => {
      assert.equal(tool, "docker");
      if (args[0] === "image") return Buffer.from(IMAGE);
      if (args[0] === "run") {
        source = /src=(.*),dst=\/socket/.exec(
          args[args.indexOf("--mount") + 1],
        )[1];
        assert(
          !source.startsWith("/proc/"),
          "runc rejects procfd mount sources (status 125)",
        );
        assert.equal(args[args.indexOf("--entrypoint") + 1], "/bin/sh");
        const command = args.slice(args.indexOf(IMAGE) + 1);
        assert.equal(command[0], "-c");
        assert.match(command[1], /mkfifo/);
        assert.match(command[1], /read -r/);
        assert.match(
          command[1],
          /exec \/usr\/local\/bin\/docker-entrypoint\.sh/,
        );
        assert.match(command[3], /^[a-f0-9-]{36}$/);
        token = command[3];
        assert(
          !command[1].includes(token),
          "nonce must not be interpolated into shell text",
        );
        assert(
          !command[1].includes("/socket"),
          "inert PID 1 must not touch the bind mount",
        );
        assert.equal(command[4], "postgres");
        if (wrongMount) {
          await rename(source, base + "/original");
          await mkdir(source, { mode: 0o700 });
          await writeFile(source + "/sentinel", "untouched");
        }
        mount = await open(source, "r");
        container = {
          HostConfig: {
            LogConfig: { Type: args[args.indexOf("--log-driver") + 1] },
            NetworkMode: args[args.indexOf("--network") + 1],
            Tmpfs: {
              "/var/lib/postgresql/data":
                args[args.indexOf("--tmpfs") + 1].split(":")[1],
            },
          },
          Mounts: [
            { Type: "bind", Source: source, Destination: "/socket", RW: true },
          ],
        };
        policy?.(container);
        events.push("inert");
        return Buffer.from("container");
      }
      if (args[0] === "inspect") {
        events.push("policy");
        return Buffer.from(JSON.stringify(container));
      }
      if (args[0] === "exec" && args[2] === "stat") {
        assert(!started);
        events.push("identity");
        const s = await mount.stat();
        return Buffer.from(`${s.dev}:${wrongIdentity ? s.ino + 1 : s.ino}`);
      }
      if (args[0] === "exec" && args[2] === "sh") {
        const script = args[4];
        if (script.includes("printf")) {
          assert(events.includes("identity"));
          assert(events.includes("policy"));
          assert(events.includes("ready"));
          assert(options.timeoutMs <= 15000, "FIFO write must be bounded");
          assert.equal(
            args.at(-1),
            token,
            "only the matching positional nonce releases PID 1",
          );
          if (failAt === "signal") throw Error("SIGNAL_UNCERTAIN");
          events.push("start");
          started = true;
        } else if (script.includes("psql")) {
          assert(started, "no psql before the start gate");
          events.push("psql");
        } else {
          assert(!started);
          assert(options.timeoutMs <= 15000, "FIFO readiness must be bounded");
          events.push("ready");
          if (failAt === "ready") throw Error("FIFO_NOT_READY");
        }
        return Buffer.alloc(0);
      }
      if (["stop", "rm"].includes(args[0])) {
        events.push(args[0]);
        return Buffer.alloc(0);
      }
      assert.fail("unexpected Docker operation: " + args.join(" "));
    },
  });
  return {
    restorer,
    events,
    base,
    get source() {
      return source;
    },
    get clientCount() {
      return clientCount;
    },
  };
}

for (const failAt of ["ready", "signal"]) {
  test(`a failed ${failAt} gate cleans up without any PG client`, async (t) => {
    const state = await exercise(t, { failAt });
    await assert.rejects(
      state.restorer.createRestoreFixture(),
      /FIFO_NOT_READY|SIGNAL_UNCERTAIN/,
    );
    assert.deepEqual(state.events, [
      "inert",
      "identity",
      "policy",
      "ready",
      "stop",
      "rm",
    ]);
    assert.equal(state.clientCount, 0);
  });
}

test("portable physical bind starts inert and releases PG only after mount and policy verification", async (t) => {
  const state = await exercise(t);
  const fixture = await state.restorer.createRestoreFixture();
  try {
    assert.match(fixture.socketPath, /^\/proc\/\d+\/fd\/\d+$/);
    assert.notEqual(fixture.socketPath, state.source);
    assert.deepEqual(state.events.slice(0, 6), [
      "inert",
      "identity",
      "policy",
      "ready",
      "start",
      "psql",
    ]);
  } finally {
    await fixture.close();
  }
  assert.deepEqual(state.events.slice(-2), ["stop", "rm"]);
});

test("a replaced physical leaf stays inert, never creates a client, and cleanup preserves the replacement", async (t) => {
  const state = await exercise(t, { wrongMount: true });
  await assert.rejects(
    state.restorer.createRestoreFixture(),
    /FIXTURE_CLEANUP_FAILED/,
  );
  assert.deepEqual(state.events, ["inert", "identity", "stop", "rm"]);
  assert.equal(state.clientCount, 0);
  assert.equal(await readFile(state.source + "/sentinel", "utf8"), "untouched");
  assert.equal((await stat(state.source)).mode & 0o777, 0o700);
});

test("a mismatched daemon-mounted inode is rejected before release", async (t) => {
  const state = await exercise(t, { wrongIdentity: true });
  await assert.rejects(
    state.restorer.createRestoreFixture(),
    /FIXTURE_MOUNT_IDENTITY_CHANGED/,
  );
  assert.deepEqual(state.events, ["inert", "identity", "stop", "rm"]);
  assert.equal(state.clientCount, 0);
});

for (const [label, policy] of [
  [
    "logging",
    (c) => {
      c.HostConfig.LogConfig.Type = "json-file";
    },
  ],
  [
    "network",
    (c) => {
      c.HostConfig.NetworkMode = "bridge";
    },
  ],
  [
    "storage",
    (c) => {
      c.HostConfig.Tmpfs = {};
    },
  ],
  [
    "extra volume",
    (c) => {
      c.Mounts.push({ Type: "volume", Destination: "/elsewhere" });
    },
  ],
]) {
  test(`inert restore rejects changed ${label} policy before PG start`, async (t) => {
    const state = await exercise(t, { policy });
    await assert.rejects(
      state.restorer.createRestoreFixture(),
      /PRIVATE_LOGGING_REJECTED|FIXTURE_ISOLATION_REJECTED/,
    );
    assert.deepEqual(state.events, [
      "inert",
      "identity",
      "policy",
      "stop",
      "rm",
    ]);
    assert.equal(state.clientCount, 0);
  });
}
