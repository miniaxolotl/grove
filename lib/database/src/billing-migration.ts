import type { Knex } from "knex";

export const billing = {
  name: "20261024_023_billing",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE billing_customers (
        account_id uuid PRIMARY KEY REFERENCES accounts(id), customer_id text UNIQUE,
        checkout_operation uuid NOT NULL DEFAULT gen_random_uuid(),
        checkout_id text, checkout_price text,
        UNIQUE(account_id, customer_id)
      );
      CREATE TABLE billing_subscriptions (
        id text PRIMARY KEY, account_id uuid NOT NULL, customer_id text NOT NULL,
        price_id text NOT NULL, status text NOT NULL,
        period_end timestamptz NOT NULL, cancel_at_period_end boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(account_id,customer_id) REFERENCES billing_customers(account_id,customer_id)
      );
      CREATE INDEX billing_subscriptions_account ON billing_subscriptions(account_id,period_end);
      CREATE TABLE billing_events (
        id text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
        received_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    for (const table of [
      "billing_customers",
      "billing_subscriptions",
      "billing_events",
    ]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      // Like accounts, customer lookup permits the non-runtime table owner to
      // resolve a signed provider customer before a tenant context is available.
      if (table !== "billing_customers")
        await db.raw("ALTER TABLE ?? FORCE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid) WITH CHECK (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw("GRANT SELECT, INSERT, UPDATE ON ?? TO grove_runtime", [
        table,
      ]);
    }
    await db.raw(`
      GRANT SELECT ON billing_subscriptions, billing_customers TO grove_worker;
      CREATE FUNCTION grove_billing_account(customer text) RETURNS uuid
        LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT account_id FROM public.billing_customers WHERE customer_id=customer
        $$;
      REVOKE ALL ON FUNCTION grove_billing_account(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_billing_account(text) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
