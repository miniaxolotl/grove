import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { rolloutMigrations } from "./database-rollout.mjs";

const names = [
  "20261119_048_lifecycle_reconciliation",
  "20261127_049_note_capacity",
];
const base = {
  GITHUB_REPOSITORY: "miniaxolotl/grove",
  GITHUB_REF: "refs/heads/production",
  GITHUB_REF_PROTECTED: "true",
  GITHUB_SHA: "b".repeat(40),
  RELEASE_SOURCE_SHA: "a".repeat(40),
  RELEASE_TAG: "v1.11.39",
  GROVE_MIGRATION_DATABASE_URL:
    "postgresql://grove_owner:private-owner@db.example/grove?sslmode=verify-full",
  GROVE_API_DATABASE_URL:
    "postgresql://grove_api:private-api@db.example/grove?sslmode=verify-full",
  GROVE_WORKER_DATABASE_URL:
    "postgresql://grove_jobs:private-worker@db.example/grove?sslmode=verify-full",
};
const environment = () => ({ ...base });

function fixture(options = {}) {
  const calls = [];
  const history = options.history ?? names.slice(0, 1);
  const trx = {
    raw: async (sql) => {
      calls.push(sql);
      if (sql.startsWith("LOCK TABLE")) {
        const error = options.lockErrors?.shift();
        if (error) throw error;
      }
      if (sql.includes("pg_try_advisory_xact_lock"))
        return { rows: [{ acquired: !options.locked }] };
      if (sql.includes("pg_get_userbyid"))
        return {
          rows: [
            {
              username: options.owner ?? "grove_owner",
              owner: "grove_owner",
              database: "grove",
              owns_memories: true,
            },
          ],
        };
      if (sql.includes("is_locked"))
        return { rows: [{ is_locked: options.knexLocked ? 1 : 0 }] };
      if (sql.includes("SELECT name FROM"))
        return { rows: history.map((name) => ({ name })) };
      return { rows: [] };
    },
    migrate: {
      latest: async () => {
        calls.push("migrate");
        const error = options.errors?.shift();
        if (error) throw error;
        if (options.error) throw options.error;
        const pending = names.slice(history.length);
        history.push(...pending);
        return [1, pending];
      },
    },
  };
  return {
    calls,
    registry: names.map((name) => ({ name })),
    assertSource: () => calls.push("source"),
    assertCurrent: () => {
      calls.push("fence");
      if (options.superseded) throw new Error("private-secret");
    },
    connect: () => {
      calls.push("connect");
      return {
        transaction: async (run) => {
          calls.push("begin");
          try {
            const result = await run(trx);
            calls.push("commit");
            return result;
          } catch (error) {
            calls.push("rollback");
            throw error;
          }
        },
        destroy: async () => {
          calls.push("close");
        },
      };
    },
    wait: async (ms) => calls.push(["wait", ms]),
    onRetry: (event) => calls.push(["retry", event]),
  };
}

const pgError = (code) =>
  Object.assign(new Error("private SQL private-owner"), { code });

test("confirmed deadlocks retry the whole rolled-back transaction with fresh fences and bounded backoff", async () => {
  const deps = fixture({ errors: [pgError("40P01"), pgError("40P01")] });
  const result = await rolloutMigrations(environment(), deps);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.applied, [names[1]]);
  assert.equal(deps.calls.filter((call) => call === "begin").length, 3);
  assert.equal(deps.calls.filter((call) => call === "rollback").length, 2);
  assert.equal(deps.calls.filter((call) => call === "fence").length, 4);
  assert.equal(deps.calls.filter((call) => call === "source").length, 3);
  for (const [index, call] of deps.calls.entries()) {
    if (Array.isArray(call) && call[0] === "wait") {
      assert(call[1] >= 1000 && call[1] <= 4250);
      assert.equal(deps.calls[index - 2], "rollback");
    }
  }
  assert.doesNotMatch(
    JSON.stringify(deps.calls.filter(Array.isArray)),
    /private|SQL/,
  );
});

test("NOWAIT table admission yields and retries without entering DDL or holding locks during backoff", async () => {
  const deps = fixture({ lockErrors: [pgError("55P03")] });
  const result = await rolloutMigrations(environment(), deps);
  assert.equal(result.attempts, 2);
  assert.equal(deps.calls.filter((call) => call === "migrate").length, 1);
  assert.equal(deps.calls.filter((call) => call === "rollback").length, 1);
  const lock = deps.calls.find(
    (call) =>
      typeof call === "string" &&
      call.startsWith("LOCK TABLE public.memories "),
  );
  assert.match(lock, /public\.memories/);
  assert.match(lock, /NOWAIT/);
  assert(deps.calls.indexOf(lock) < deps.calls.indexOf("migrate"));
});

test("a competing completed rollout becomes a no-op, while changed history and retained locks still stop retries", async () => {
  const history = names.slice(0, 1);
  const deps = fixture({ history, errors: [pgError("40P01")] });
  deps.wait = async () => {
    history.push(names[1]);
  };
  const result = await rolloutMigrations(environment(), deps);
  assert.equal(result.status, "unchanged");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.applied, []);
  assert.equal(deps.calls.filter((call) => call === "migrate").length, 1);
  for (const drift of ["history", "knexLocked", "owner", "locked"]) {
    const options = { errors: [pgError("40P01")], history: names.slice(0, 1) };
    const changed = fixture(options);
    changed.wait = async () => {
      if (drift === "history") options.history.push("unknown");
      else options[drift] = drift === "owner" ? "grove_api" : true;
    };
    await assert.rejects(rolloutMigrations(environment(), changed));
    assert.equal(changed.calls.filter((call) => call === "migrate").length, 1);
  }
});

test("persistent admission contention is bounded and permanent admission errors do not retry", async () => {
  const deps = fixture({
    lockErrors: Array.from({ length: 4 }, () => pgError("55P03")),
  });
  await assert.rejects(
    rolloutMigrations(environment(), deps),
    /migration table lock admission \(55P03\).*4 attempts/,
  );
  assert.equal(deps.calls.filter((call) => call === "begin").length, 4);
  assert(!deps.calls.includes("migrate"));
  const denied = fixture({ lockErrors: [pgError("42501")] });
  await assert.rejects(rolloutMigrations(environment(), denied), /42501/);
  assert.equal(denied.calls.filter((call) => call === "begin").length, 1);
});

test("persistent deadlocks stop after four attempts without leaking SQL or credentials", async () => {
  const deps = fixture({ error: pgError("40P01") });
  await assert.rejects(rolloutMigrations(environment(), deps), (error) => {
    assert.match(error.message, /40P01/);
    assert.match(error.message, /4 attempts/);
    assert.doesNotMatch(error.message, /private|SQL/);
    return true;
  });
  assert.equal(deps.calls.filter((call) => call === "begin").length, 4);
  assert.equal(
    deps.calls.filter((call) => Array.isArray(call) && call[0] === "wait")
      .length,
    3,
  );
  assert.equal(deps.calls.at(-1), "close");
});

test("DDL lock timeouts, permanent errors and uncertain connection outcomes never retry", async () => {
  for (const code of [
    "55P03",
    "57014",
    "42501",
    "42703",
    "40001",
    "ECONNRESET",
    "ETIMEDOUT",
  ]) {
    const deps = fixture({ error: pgError(code) });
    await assert.rejects(
      rolloutMigrations(environment(), deps),
      new RegExp(code),
    );
    assert.equal(deps.calls.filter((call) => call === "begin").length, 1);
    assert.equal(deps.calls.filter(Array.isArray).length, 0);
  }
});

test("a superseded release cannot retry a deadlock and the total ten-minute budget is not reset", async () => {
  const deps = fixture({ error: pgError("40P01") });
  let fences = 0;
  deps.assertCurrent = () => {
    if (++fences === 3) throw new Error("private superseded source");
  };
  await assert.rejects(
    rolloutMigrations(environment(), deps),
    /current production fence/,
  );
  assert.equal(deps.calls.filter((call) => call === "begin").length, 1);
  const deadline = fixture({ error: pgError("40P01") });
  let clock = 0;
  deadline.now = () => clock;
  deadline.wait = async () => {
    clock = 600_001;
  };
  await assert.rejects(
    rolloutMigrations(environment(), deadline),
    /retry deadline/,
  );
  assert.equal(deadline.calls.filter((call) => call === "begin").length, 1);
});

test("exact-source guarded rollout applies only pending migrations and closes its owner pool", async () => {
  const deps = fixture();
  const result = await rolloutMigrations(environment(), deps);
  assert.deepEqual(result.applied, [names[1]]);
  assert.equal(result.sourceSha, base.RELEASE_SOURCE_SHA);
  assert.equal(result.status, "completed");
  assert.equal(deps.calls.filter((c) => c === "fence").length, 2);
  assert.ok(deps.calls.indexOf("source") < deps.calls.indexOf("connect"));
  assert.ok(deps.calls.indexOf("migrate") > deps.calls.indexOf("begin"));
  assert.equal(deps.calls.at(-1), "close");
  assert.ok(deps.calls.some((c) => c.includes("lock_timeout")));
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-|db.example|backup|11111111/,
  );
});

test("an already committed rollout is a no-op without any backup/restore evidence", async () => {
  const deps = fixture({ history: [...names] });
  const result = await rolloutMigrations(environment(), deps);
  assert.deepEqual(result.applied, []);
  assert.equal(result.status, "unchanged");
  assert.ok(!deps.calls.includes("migrate"));
});

test("unsafe configuration and superseded releases fail before any database connection", async () => {
  for (const change of [
    { GITHUB_REF: "refs/heads/development" },
    { GITHUB_REF_PROTECTED: "false" },
    { GITHUB_REPOSITORY: "other/grove" },
    { RELEASE_SOURCE_SHA: "" },
    { GROVE_MIGRATION_DATABASE_URL: "" },
    { GROVE_MIGRATION_DATABASE_URL: base.GROVE_API_DATABASE_URL },
    {
      GROVE_MIGRATION_DATABASE_URL: base.GROVE_MIGRATION_DATABASE_URL.replace(
        "db.example",
        "other.example",
      ),
    },
    {
      GROVE_MIGRATION_DATABASE_URL:
        base.GROVE_MIGRATION_DATABASE_URL + "&host=other.example",
    },
    { GROVE_API_DATABASE_URL: base.GROVE_API_DATABASE_URL + "&dbname=other" },
  ]) {
    const deps = fixture();
    await assert.rejects(
      rolloutMigrations({ ...environment(), ...change }, deps),
    );
    assert.ok(!deps.calls.includes("connect"));
  }
  const deps = fixture({ superseded: true });
  await assert.rejects(
    rolloutMigrations(environment(), deps),
    (error) => !error.message.includes("private-secret"),
  );
  assert.ok(!deps.calls.includes("connect"));
});

test("locks, history drift and unsafe ownership never reach migrations", async () => {
  for (const options of [
    { locked: true },
    { knexLocked: true },
    { history: ["unknown"] },
    { owner: "grove_api" },
  ]) {
    const deps = fixture(options);
    await assert.rejects(rolloutMigrations(environment(), deps));
    assert.ok(!deps.calls.includes("migrate"));
    assert.equal(deps.calls.at(-1), "close");
  }
});

test("migration failure exposes only a safe stage and database code, never SQL or credentials", async () => {
  const deps = fixture({
    error: Object.assign(new Error("SQL private-owner private-api"), {
      code: "55P03",
    }),
  });
  await assert.rejects(rolloutMigrations(environment(), deps), (error) => {
    assert.match(error.message, /55P03/);
    assert.doesNotMatch(error.message, /SQL|private-/);
    return true;
  });
  assert.equal(deps.calls.at(-1), "close");
});

test("real checkout/tag checks reject drift before connecting and accept only the clean admitted source", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "grove-migration-source-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  writeFileSync(join(directory, "source.txt"), "admitted\n");
  git("add", "source.txt");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  git("tag", "v1.11.39");
  const source = git("rev-parse", "HEAD");
  const cwd = process.cwd();
  process.chdir(directory);
  try {
    const deps = fixture();
    delete deps.assertSource;
    // A synthetic connect failure marks that the real identity guard passed.
    deps.connect = () => {
      throw Object.assign(new Error("private-owner"), { code: "ECONNREFUSED" });
    };
    await assert.rejects(
      rolloutMigrations({ ...environment(), RELEASE_SOURCE_SHA: source }, deps),
      /database connection \(ECONNREFUSED\)/,
    );
    writeFileSync(join(directory, "source.txt"), "changed\n");
    await assert.rejects(
      rolloutMigrations({ ...environment(), RELEASE_SOURCE_SHA: source }, deps),
      /protected release identity/,
    );
    await assert.rejects(
      rolloutMigrations(environment(), deps),
      /protected release identity/,
    );
  } finally {
    process.chdir(cwd);
  }
});
