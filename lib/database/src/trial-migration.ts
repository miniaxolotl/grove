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
    // Runtime has no DELETE on billing_trials and no access to the audit
    // table, so eligibility restoration goes through this guarded function
    // like every other admin write.
    await db.raw(`
      CREATE FUNCTION grove_admin_trial_reset(target uuid, operation uuid, explanation text) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE actor uuid; previous public.system_admin_audit;
        BEGIN
          actor := public.grove_admin_guard();
          IF operation IS NULL OR explanation IS NULL OR length(trim(explanation)) NOT BETWEEN 3 AND 300 THEN
            RAISE EXCEPTION 'invalid_request' USING ERRCODE='GA002';
          END IF;
          SELECT * INTO previous FROM public.system_admin_audit WHERE id=operation;
          IF FOUND THEN
            IF previous.kind<>'change' OR previous.actor_id IS DISTINCT FROM actor OR previous.account_id IS DISTINCT FROM target
              OR previous.reason IS DISTINCT FROM explanation THEN
              RAISE EXCEPTION 'operation_conflict' USING ERRCODE='GA003';
            END IF;
            RETURN previous.after;
          END IF;
          IF NOT EXISTS(SELECT 1 FROM public.billing_trials WHERE account_id=target) THEN
            RAISE EXCEPTION 'account_unavailable' USING ERRCODE='GA004';
          END IF;
          DELETE FROM public.billing_trials WHERE account_id=target;
          INSERT INTO public.system_admin_audit(id,actor_id,account_id,kind,reason,before,after)
            VALUES(operation,actor,target,'change',explanation,
              jsonb_build_object('trialEligible',false),
              jsonb_build_object('trialEligible',true));
          RETURN jsonb_build_object('accountId',target,'eligible',true);
        END $$;
      REVOKE ALL ON FUNCTION grove_admin_trial_reset(uuid,uuid,text) FROM PUBLIC,grove_runtime,grove_worker;
      GRANT EXECUTE ON FUNCTION grove_admin_trial_reset(uuid,uuid,text) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
