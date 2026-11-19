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
          if (name === "worker") {
            // LIMIT 0 checks shape and read grants without reading recipients or
            // invoking queue/mail effects. regprocedure casts only resolve names.
            await trx.raw(
              "SELECT fingerprint, export_task_id, export_preparation_id FROM transactional_emails LIMIT 0",
            );
            await trx.raw(
              "SELECT id, account_id, snapshot, due_at, attempts, lease_id, lease_until, dispatched_at, dispatch_id, dispatch_until, fingerprint, accepted_at, provider_id, failed_at, error_code FROM deletion_receipts LIMIT 0",
            );
            await trx.raw(
              "SELECT 'public.grove_dispatch_receipts()'::regprocedure, 'public.grove_mark_receipt_dispatched(uuid,uuid)'::regprocedure, 'public.grove_claim_receipt(uuid)'::regprocedure, 'public.grove_sweep_receipts(boolean)'::regprocedure",
            );
          }
        });
      } finally {
        await db.destroy();
      }
    } catch {
      throw new Error(
        `Production ${name} schema preflight failed. Verify connectivity and runtime grants, then have the migration owner apply the admitted source's pending forward migrations before retrying. Migrations 045–048 provide import destination, email fingerprints, deletion receipts and lifecycle reconciliation. No migrations were run by this check.`,
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
