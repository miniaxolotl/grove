import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import { preflightDatabases } from "./database-preflight.mjs";

const env = {
  GROVE_API_DATABASE_URL:
    "postgresql://grove_api:private-api@db.example/grove?sslmode=verify-full",
  GROVE_WORKER_DATABASE_URL:
    "postgresql://grove_jobs:private-worker@db.example/grove?sslmode=verify-full",
};

function fixture(fail = false, missing = null) {
  const calls = [];
  return {
    calls,
    connect(url, options) {
      calls.push(["connect", new URL(url).username, options]);
      return {
        async transaction(run) {
          return run({
            raw: async (sql) => {
              calls.push(["sql", sql]);
              if (missing && sql.includes(missing))
                throw new Error("private-worker missing schema");
            },
          });
        },
        async destroy() {
          calls.push(["close"]);
        },
      };
    },
    async probe() {
      calls.push(["probe"]);
      if (fail) throw new Error("column units missing private-api");
    },
  };
}

test("preflight probes both least-privilege roles inside read-only transactions and closes pools", async () => {
  const dependencies = fixture();
  await preflightDatabases(env, dependencies);
  assert.deepEqual(
    dependencies.calls.map(([kind]) => kind),
    [
      "connect",
      "sql",
      "probe",
      "close",
      "connect",
      "sql",
      "probe",
      "sql",
      "sql",
      "sql",
      "close",
    ],
  );
  assert.equal(dependencies.calls[0][1], "grove_api");
  assert.equal(dependencies.calls[4][1], "grove_jobs");
  for (const [kind, value, options] of dependencies.calls) {
    if (kind === "sql")
      assert.match(value, /^(SET TRANSACTION READ ONLY|SELECT )/);
    if (kind === "connect")
      assert.deepEqual(options, {
        ssl: true,
        max: 1,
        acquireTimeoutMs: 10000,
        statementTimeoutMs: 10000,
      });
  }
});

test("worker preflight rejects missing email and receipt schema before publication without executing mail functions", async () => {
  for (const missing of [
    "fingerprint",
    "deletion_receipts",
    "grove_claim_receipt",
  ]) {
    const dependencies = fixture(false, missing);
    await assert.rejects(
      preflightDatabases(env, dependencies),
      /worker schema preflight failed/,
    );
    assert.equal(dependencies.calls.at(-1)[0], "close");
  }
  const dependencies = fixture();
  await preflightDatabases(env, dependencies);
  const sql = dependencies.calls
    .filter(([kind]) => kind === "sql")
    .map(([, value]) => value)
    .join("\n");
  assert.match(
    sql,
    /SELECT fingerprint, export_task_id, export_preparation_id FROM transactional_emails LIMIT 0/,
  );
  assert.match(sql, /SELECT .* FROM deletion_receipts LIMIT 0/);
  assert.match(sql, /'public.grove_claim_receipt\(uuid\)'::regprocedure/);
  assert.doesNotMatch(
    sql,
    /SELECT (public\.)?grove_(dispatch|claim|sweep|mark)/,
  );
});

test("missing, unsafe, or different database targets fail before connecting without leaking URLs", async () => {
  for (const change of [
    { GROVE_API_DATABASE_URL: "" },
    { GROVE_WORKER_DATABASE_URL: "invalid-private-url" },
    {
      GROVE_API_DATABASE_URL: env.GROVE_API_DATABASE_URL.replace(
        "grove_api",
        "grove_owner",
      ),
    },
    {
      GROVE_WORKER_DATABASE_URL: env.GROVE_WORKER_DATABASE_URL.replace(
        "verify-full",
        "disable",
      ),
    },
    {
      GROVE_WORKER_DATABASE_URL: env.GROVE_WORKER_DATABASE_URL.replace(
        "db.example",
        "other.example",
      ),
    },
    {
      GROVE_WORKER_DATABASE_URL: env.GROVE_WORKER_DATABASE_URL.replace(
        "/grove?",
        "/other?",
      ),
    },
  ]) {
    const dependencies = fixture();
    await assert.rejects(
      preflightDatabases({ ...env, ...change }, dependencies),
      (error) => {
        assert.doesNotMatch(
          String(error),
          /private-api|private-worker|invalid-private-url/,
        );
        return true;
      },
    );
    assert.deepEqual(dependencies.calls, []);
  }
});

test("missing schema fails closed with an operator migration instruction and pool cleanup", async () => {
  const dependencies = fixture(true);
  await assert.rejects(preflightDatabases(env, dependencies), (error) => {
    assert.match(String(error), /API.*schema.*migration/i);
    assert.doesNotMatch(String(error), /private-api/);
    return true;
  });
  assert.equal(dependencies.calls.at(-1)[0], "close");
  assert.equal(
    dependencies.calls.filter(([kind]) => kind === "connect").length,
    1,
  );
});

test("preflight reports safe database error codes without stale migration ranges or private SQL", async () => {
  const dependencies = fixture();
  dependencies.probe = async () => {
    throw Object.assign(
      new Error("SELECT private-api, private-worker FROM private_table"),
      { code: "42P01" },
    );
  };
  await assert.rejects(preflightDatabases(env, dependencies), (error) => {
    assert.match(error.message, /42P01/);
    assert.doesNotMatch(error.message, /045|048|private-|private_table/);
    return true;
  });
});

test("production checks candidate schema before publication and again before rollout", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  const publish = workflow.split("\n  publish:\n")[1].split("\n  deploy:\n")[0];
  const deploy = workflow.split("\n  deploy:\n")[1].split("\n  website:\n")[0];
  const command = "node --import tsx scripts/release/database-preflight.mjs";
  for (const job of [publish, deploy]) {
    assert.ok(job.includes(command), "Missing fail-closed schema preflight");
    assert.match(
      job,
      /GROVE_API_DATABASE_URL: \$\{\{ secrets.GROVE_API_DATABASE_URL \}\}/,
    );
    assert.match(
      job,
      /GROVE_WORKER_DATABASE_URL: \$\{\{ secrets.GROVE_WORKER_DATABASE_URL \}\}/,
    );
    assert.doesNotMatch(job, /migrate\.latest|bootstrap\.js/);
  }
  assert.ok(
    publish.indexOf(command) <
      publish.indexOf("Upload exact-source diagnostics"),
  );
  assert.ok(
    deploy.indexOf(command) < deploy.indexOf("Deploy the verified image"),
  );
});
