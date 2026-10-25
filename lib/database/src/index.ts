import knex from "knex";
import { Model, knexSnakeCaseMappers } from "objection";
import type { Knex } from "knex";
import { migrationSource } from "./migrations.ts";
import { databaseSignal } from "./context.ts";

export { migrationSource };
export { databaseSignal, withDatabaseSignal } from "./context.ts";
export type { Knex };
export type { QueryBuilder } from "objection";
const statementTimeouts = new WeakMap<Knex, number>();

export function createDatabase(
  url: string,
  options: {
    ssl?: boolean;
    max?: number;
    acquireTimeoutMs?: number;
    statementTimeoutMs?: number;
  } = {},
) {
  const db = knex({
    client: "pg",
    connection: {
      connectionString: url,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: options.acquireTimeoutMs ?? 10000,
      statement_timeout: options.statementTimeoutMs,
      application_name: "grove",
    },
    pool: { min: 0, max: options.max ?? 8 },
    acquireConnectionTimeout: options.acquireTimeoutMs ?? 10000,
    ...knexSnakeCaseMappers(),
    migrations: { migrationSource },
  });
  statementTimeouts.set(db, options.statementTimeoutMs ?? 10000);
  return db;
}

export const closeDatabase = (db: Knex) => db.destroy();

/** Knex's postProcessResponse maps query-builder rows, not pg's raw result wrapper. */
export function camelRows<T>(result: { rows: Record<string, unknown>[] }): T[] {
  return result.rows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_match, letter: string) =>
            letter.toUpperCase(),
          ),
          value,
        ]),
      ) as T,
  );
}

export async function tenant<T>(
  db: Knex,
  accountId: string,
  run: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  const signal = databaseSignal();
  signal?.throwIfAborted();
  return db.transaction(async (trx) => {
    signal?.throwIfAborted();
    await trx.raw(
      "SELECT set_config('grove.account_id', ?, true), set_config('statement_timeout', ?, true)",
      [accountId, String(statementTimeouts.get(db) ?? 10000)],
    );
    const result = await run(trx);
    // An aborted save must roll back, including when cancellation arrived during SQL.
    signal?.throwIfAborted();
    return result;
  });
}

export async function probeDatabase(db: Knex) {
  const { rows } = await db.raw(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const owner = await db.raw(
    "SELECT 1 FROM pg_tables WHERE tablename = 'memories' AND tableowner = current_user",
  );
  if (rows[0]?.rolsuper || rows[0]?.rolbypassrls || owner.rows.length) {
    throw new Error(
      "Grove requires a non-owner, non-bypass database runtime role",
    );
  }
  await db.raw(
    "SELECT content_version, ask_enabled, export_version, filing_enabled, change_token, admin_suspended FROM accounts LIMIT 0",
  );
  await db.raw("SELECT id, lane, lease_id FROM background_tasks LIMIT 0");
  await db.raw("SELECT status, archive_operation_id FROM projects LIMIT 0");
  await db.raw("SELECT duration_ms FROM speech_usage LIMIT 0");
  await db.raw("SELECT archive_operation_id FROM memories LIMIT 0");
  await db.raw("SELECT tools, tools_version FROM conversations LIMIT 0");
  const versions = await db.raw(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (!versions.rows[0]) throw new Error("The vector extension is required");
  const search = await db.raw(
    "SELECT 1 FROM pg_extension WHERE extname='pg_trgm' AND to_regprocedure('public.grove_search_title(text,text)') IS NOT NULL",
  );
  if (!search.rows.length)
    throw new Error("The search-quality migration (pg_trgm) is required");
}

/** Explicit transaction binding; no module-global connection or tenant state. */
export class MemoryModel extends Model {
  static tableName = "memories";
  id!: string;
  accountId!: string;
  projectId!: string | null;
  content!: string;
  kind!: "preference" | "fact" | "decision" | "solution" | "handoff";
  autoKind!: boolean;
  status!: "active" | "archived";
  version!: number;
  source!: {
    agent:
      | "website"
      | "opencode"
      | "claude"
      | "codex"
      | "cli"
      | "import"
      | "api";
    session?: string;
    verification?: string;
  };
  taskId!: string | null;
  retentionDays!: number | null;
  expiresAt!: Date | null;
  purgeAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  static jsonAttributes = ["source"];
}
