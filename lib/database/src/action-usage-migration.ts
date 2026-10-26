import type { Knex } from "knex";

export const actionUsage = {
  name: "20261025_028_action_usage",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE action_usage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),
        metric text NOT NULL CHECK(metric IN ('recall','ask','organization','assistance')),
        operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 256), period date NOT NULL,
        status text NOT NULL CHECK(status IN ('reserved','completed','released')), worked boolean NOT NULL DEFAULT false,
        lease_id uuid NOT NULL, lease_until timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id,metric,operation)
      );
      CREATE INDEX action_usage_period ON action_usage(account_id,period,metric,status);
      CREATE TABLE ai_operation_leases (
        id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
        lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ai_operation_leases_account ON ai_operation_leases(account_id,lease_until);
    `);
    for (const table of ["action_usage", "ai_operation_leases"]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw("ALTER TABLE ?? FORCE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ?? TO grove_runtime,grove_worker",
        [table],
      );
    }
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
