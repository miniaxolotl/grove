import knex from "knex";
import { Model, knexSnakeCaseMappers } from "objection";
import type { Knex } from "knex";
import { migrationSource } from "./migrations.ts";

export { migrationSource };
export type { Knex };

export function createDatabase(
  url: string,
  options: { ssl?: boolean; max?: number } = {},
) {
  return knex({
    client: "pg",
    connection: {
      connectionString: url,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: 10000,
      application_name: "grove",
    },
    pool: { min: 0, max: options.max ?? 8 },
    acquireConnectionTimeout: 10000,
    ...knexSnakeCaseMappers(),
    migrations: { migrationSource },
  });
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
  return db.transaction(async (trx) => {
    await trx.raw("SELECT set_config('grove.account_id', ?, true)", [
      accountId,
    ]);
    await trx.raw("SET LOCAL statement_timeout = '10000ms'");
    return run(trx);
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
  await db.raw("SELECT content_version FROM accounts LIMIT 0");
  const versions = await db.raw(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (!versions.rows[0]) throw new Error("The vector extension is required");
}

/** Explicit transaction binding; no module-global connection or tenant state. */
export class MemoryModel extends Model {
  static tableName = "memories";
  id!: string;
  accountId!: string;
  projectId!: string | null;
  content!: string;
  kind!: "preference" | "fact" | "decision" | "solution" | "handoff";
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
  expiresAt!: Date | null;
  purgeAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  static jsonAttributes = ["source"];
}
