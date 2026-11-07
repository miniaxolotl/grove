import type { Knex } from "knex";

/**
 * Single-use Pro trial consumption. Set once when a trial starts; webhooks
 * and subscription sync never clear it. Admin reset restores eligibility.
 */
export const billingTrial = {
  name: "20261107_040_billing_trial",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE billing_trials (
        account_id uuid PRIMARY KEY REFERENCES accounts(id),
        consumed_at timestamptz NOT NULL DEFAULT now(),
        subscription_id text,
        reset_by uuid REFERENCES accounts(id),
        reset_at timestamptz
      );
    `);
    await db.raw(
      "ALTER TABLE billing_trials ENABLE ROW LEVEL SECURITY",
    );
    await db.raw("ALTER TABLE billing_trials FORCE ROW LEVEL SECURITY");
    await db.raw(
      `CREATE POLICY tenant ON billing_trials USING (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid) WITH CHECK (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
    );
    await db.raw("GRANT SELECT, INSERT, UPDATE ON billing_trials TO grove_runtime");
    await db.raw("GRANT SELECT ON billing_trials TO grove_worker");
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
