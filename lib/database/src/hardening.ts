import type { Knex } from "knex";

export const hardening = {
  name: "20261018_002_lifecycle_bounds",
  async up(db: Knex) {
    await db.raw(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE OR REPLACE FUNCTION grove_claim_job() RETURNS SETOF jobs
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE jobs SET failed_at = now(), error_code = 'lease_exhausted'
          WHERE failed_at IS NULL AND attempts >= 5 AND (lease_until IS NULL OR lease_until < now());
        RETURN QUERY UPDATE jobs SET lease_id = gen_random_uuid(), lease_until = now() + interval '120 seconds', attempts = attempts + 1
          WHERE id = (SELECT j.id FROM jobs j JOIN accounts a ON a.id = j.account_id
            WHERE a.status = 'active' AND j.failed_at IS NULL AND j.attempts < 5 AND j.due_at <= now()
            AND (j.lease_until IS NULL OR j.lease_until < now()) ORDER BY j.due_at
            FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING *;
      END $$;
      CREATE OR REPLACE FUNCTION grove_maintenance_accounts() RETURNS TABLE(id uuid, status text, clerk_subject text, provider_deleted_at timestamptz)
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT a.id, a.status, a.clerk_subject, a.provider_deleted_at FROM accounts a
        WHERE a.status = 'deleting' OR EXISTS(SELECT 1 FROM memories m WHERE m.account_id = a.id AND m.purge_at <= now())
          OR EXISTS(SELECT 1 FROM rate_buckets b WHERE b.account_id = a.id AND b.minute < now() - interval '1 day')
        ORDER BY a.id LIMIT 100
      $$;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};

export const identityState = {
  name: "20261018_003_identity_state",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE subject_authority ADD COLUMN disabled boolean NOT NULL DEFAULT false;
      CREATE FUNCTION grove_user_state(subject text, event_at bigint, disabled boolean) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE subject_authority s SET disabled = grove_user_state.disabled
          WHERE s.subject = grove_user_state.subject AND s.event_at = grove_user_state.event_at AND NOT s.deleted;
        IF NOT FOUND THEN RETURN; END IF;
        UPDATE accounts SET status = CASE WHEN disabled THEN 'disabled' ELSE 'active' END
          WHERE clerk_subject = subject AND status IN ('active', 'disabled');
      END
      $$;
      CREATE OR REPLACE FUNCTION grove_account(subject text) RETURNS SETOF accounts
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(subject, 1));
        IF EXISTS(SELECT 1 FROM subject_authority s WHERE s.subject = grove_account.subject AND (s.deleted OR s.disabled)) THEN RETURN; END IF;
        INSERT INTO accounts(clerk_subject) VALUES(subject) ON CONFLICT(clerk_subject) DO NOTHING;
        RETURN QUERY SELECT * FROM accounts WHERE clerk_subject = subject;
      END $$;
      REVOKE ALL ON FUNCTION grove_user_state(text,bigint,boolean) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_user_state(text,bigint,boolean) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
