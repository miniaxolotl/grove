import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runtimeTargets, safeDatabaseCode } from "./database-target.mjs";

export async function preflightDatabases(env, dependencies) {
  const { api, worker } = runtimeTargets(env);
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
    } catch (error) {
      // A raw cause can contain SQL, parameters or connection credentials.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        `Production ${name} schema preflight failed (${safeDatabaseCode(error)}). Verify connectivity, runtime grants and the admitted source's migration history. Review the migration stage or use the owner procedure before retrying. No migrations were run by this check.`,
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
