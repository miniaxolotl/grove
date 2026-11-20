// Same bounded transaction mechanism; context selects the separately reviewed target.
import { need } from "./operator-control.mjs";
import { URL } from "node:url";
export const BOUNDS = Object.freeze({
  lockMs: 1500,
  statementMs: 10000,
  transactionMs: 10000,
  idleMs: 10000,
});
export async function verifyOwnerDatabase(db, { fixture = false } = {}) {
  const r = (
    await db.raw(
      "SELECT current_database() AS database,current_user AS role,current_setting('server_version_num') AS server,current_setting('composite_type_mismatch') AS mismatch,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser",
    )
  ).rows[0];
  need(
    r.database === (fixture ? "grove_restore" : "grove") &&
      r.role === "grove_owner" &&
      r.server === "170012" &&
      r.mismatch === "error" &&
      r.superuser === false &&
      (fixture || r.ssl === true),
    "DATABASE_IDENTITY_DRIFT",
  );
}
export function assertOwnerTarget(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    need(false, "TARGET_REJECTED");
  }
  const keys = [...u.searchParams.keys()];
  need(
    ["postgres:", "postgresql:"].includes(u.protocol) &&
      !u.hash &&
      new Set(keys).size === keys.length &&
      decodeURIComponent(u.username) === "grove_owner" &&
      (!u.port || u.port === "5432"),
    "TARGET_REJECTED",
  );
  need(
    u.hostname === "ep-mute-paper-b7a16e6n.c-13.us-east-1.aws.neon.tech" &&
      u.pathname === "/grove" &&
      u.password &&
      u.searchParams.get("sslmode") === "verify-full" &&
      keys.every((k) => ["sslmode", "channel_binding"].includes(k)),
    "TARGET_REJECTED",
  );
  return true;
}
export function barrierSql(tables) {
  need(
    Array.isArray(tables) &&
      tables.length > 0 &&
      tables.every((t) => /^[a-z][a-z0-9_]*$/.test(t)) &&
      new Set(tables).size === tables.length,
    "TABLE_INVENTORY_REJECTED",
  );
  return `LOCK TABLE ${[...tables]
    .sort()
    .map((t) => `public."${t}"`)
    .join(",")} IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
}
export async function boundedTransaction(db, run) {
  const trx = await db.transaction();
  let commitSent = false;
  try {
    for (const [setting, ms] of [
      ["lock_timeout", BOUNDS.lockMs],
      ["statement_timeout", BOUNDS.statementMs],
      ["idle_in_transaction_session_timeout", BOUNDS.idleMs],
      ["transaction_timeout", BOUNDS.transactionMs],
    ])
      await trx.raw(`SET LOCAL ${setting}='${ms}ms'`);
    await trx.raw("SET LOCAL TIME ZONE 'UTC'");
    const value = await run(trx);
    commitSent = true;
    await trx.commit();
    return value;
  } catch (error) {
    if (commitSent)
      throw Object.assign(new Error("COMMIT_UNKNOWN"), {
        code: "COMMIT_UNKNOWN",
      });
    try {
      await trx.rollback();
      error.rollbackConfirmed = true;
    } catch {
      throw Object.assign(new Error("COMMIT_UNKNOWN"), {
        code: "COMMIT_UNKNOWN",
      });
    }
    throw error;
  }
}
