import assert from "node:assert/strict";
import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

function target(value, role) {
  try {
    const url = new URL(value);
    assert(["postgres:", "postgresql:"].includes(url.protocol));
    assert.equal(decodeURIComponent(url.username), role);
    assert(url.password && url.pathname.length > 1);
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    return url;
  } catch {
    throw new Error(
      `Configure the ${role} runtime connection with verified TLS`,
    );
  }
}

export async function preflightDatabases(env, dependencies) {
  const api = target(env.GROVE_API_DATABASE_URL, "grove_api");
  const worker = target(env.GROVE_WORKER_DATABASE_URL, "grove_jobs");
  assert(
    api.hostname === worker.hostname &&
      (api.port || "5432") === (worker.port || "5432") &&
      api.pathname === worker.pathname,
    "API and worker preflight connections must target the same production database",
  );
  const { connect, probe } =
    dependencies ??
    (await import("@lib/database").then((db) => ({
      connect: db.createDatabase,
      probe: db.probeDatabase,
    })));
  for (const [name, url] of [
    ["API", api],
    ["worker", worker],
  ]) {
    try {
      const db = connect(url.href, {
        ssl: true,
        max: 1,
        acquireTimeoutMs: 10000,
        statementTimeoutMs: 10000,
      });
      try {
        await db.transaction(async (trx) => {
          await trx.raw("SET TRANSACTION READ ONLY");
          await probe(trx);
        });
      } finally {
        await db.destroy();
      }
    } catch {
      throw new Error(
        `Production ${name} schema preflight failed. Verify connectivity and runtime grants, then have the migration owner apply the admitted source's pending forward migrations before retrying. Migration 033 provides action_usage.units; no migrations were run by this check.`,
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  preflightDatabases(process.env)
    .then(() => {
      console.log(
        "Production API and worker schema probes passed in read-only transactions",
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
